import {
  ScaleSession,
  buildMeasurement,
  ageOn,
  type Profile,
  type Measurement,
} from "@diascale/core";
import type { BleClient, ScanResult } from "@capacitor-community/bluetooth-le";

const uuid = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid("ffb0");
export const WRITE = uuid("ffb1");
export const NOTIFY = uuid("ffb2");
export const INDICATE = uuid("ffb3");
type Client = Pick<
  typeof BleClient,
  | "initialize"
  | "requestLEScan"
  | "stopLEScan"
  | "connect"
  | "disconnect"
  | "read"
  | "write"
  | "startNotifications"
  | "stopNotifications"
>;
export type ScaleDevice = { id: string; name: string; rssi: number };
export type ScaleUpdate =
  | { type: "connected" }
  | { type: "live"; grams: number; status: "measuring" | "stable" | "off" }
  | { type: "result"; measurement: Measurement }
  | { type: "failure"; reason: string };

/** Manufacturer key is LE AC 2C; data excludes those two bytes on both platforms. */
export function supportedAdvertisement(result: ScanResult): boolean {
  const data = result.manufacturerData?.[String(0x2cac)];
  return (
    !!data &&
    data.byteLength >= 17 &&
    (data.getUint8(6) & 1) === 1 &&
    data.getUint8(12) === 43
  );
}

/** One adapter owns one scan or weighing. Cancel invalidates every pending callback. */
export class ScaleAdapter {
  private generation = 0;
  private cleanup: (() => Promise<void>) | null = null;
  private endScan: (() => void) | null = null;
  private closing: Promise<void> = Promise.resolve();
  private readonly client: Client;
  private readonly now: () => number;
  constructor(client: Client, now: () => number = Date.now) {
    this.client = client;
    this.now = now;
  }

  async cancel(): Promise<void> {
    ++this.generation;
    this.endScan?.();
    this.endScan = null;
    const cleanup = this.cleanup;
    this.cleanup = null;
    if (cleanup) this.closing = this.closing.then(cleanup).catch(() => {});
    await this.closing;
  }

  async scan(): Promise<ScaleDevice[]> {
    const generation = this.generation + 1;
    await this.cancel();
    if (generation !== this.generation) return [];
    await this.client.initialize({ androidNeverForLocation: true });
    if (generation !== this.generation) return [];
    const devices = new Map<string, ScaleDevice>();
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<void>((resolve) => {
      this.endScan = resolve;
      timer = setTimeout(resolve, 8000);
    });
    this.cleanup = async () => {
      clearTimeout(timer);
      await this.client.stopLEScan().catch(() => {});
    };
    try {
      await this.client.requestLEScan(
        { services: [SERVICE], allowDuplicates: true },
        (result) => {
          if (generation !== this.generation || !supportedAdvertisement(result))
            return;
          devices.set(result.device.deviceId, {
            id: result.device.deviceId,
            name: result.localName || result.device.name || "MY_SCALE",
            rssi: result.rssi ?? -127,
          });
        },
      );
      if (generation !== this.generation) {
        await this.client.stopLEScan().catch(() => {});
        return [];
      }
      await done;
      if (generation !== this.generation) return [];
      await this.cancel();
      return [...devices.values()].sort((a, b) => b.rssi - a.rssi);
    } catch (error) {
      if (generation === this.generation) await this.cancel();
      throw error;
    }
  }

  async measure(
    device: ScaleDevice,
    profile: Profile,
    userId: number,
    lastWeightKg: number,
    update: (event: ScaleUpdate) => void,
  ): Promise<void> {
    const generation = this.generation + 1;
    await this.cancel();
    if (generation !== this.generation) return;
    let completed = false;
    let timer: ReturnType<typeof setTimeout>;
    let processing: Promise<void> = Promise.resolve();
    const active = () => generation === this.generation && !completed;
    const cleanup = async () => {
      clearTimeout(timer);
      await this.client
        .stopNotifications(device.id, SERVICE, NOTIFY)
        .catch(() => {});
      await this.client
        .stopNotifications(device.id, SERVICE, INDICATE)
        .catch(() => {});
      await this.client.disconnect(device.id).catch(() => {});
    };
    this.cleanup = cleanup;
    const fail = async (reason: string) => {
      if (!active()) return;
      completed = true;
      update({ type: "failure", reason });
      await this.cancel();
    };
    timer = setTimeout(
      () =>
        void fail(
          "Waktu pengukuran habis. Turun dari timbangan, lalu ulangi dalam 60 detik dengan memegang gagang.",
        ),
      60_000,
    );
    const measuredAt = new Date(this.now()).toISOString();
    const age = ageOn(profile.birthDate, measuredAt);
    if (
      !Number.isInteger(profile.heightCm) ||
      profile.heightCm < 100 ||
      profile.heightCm > 255 ||
      !Number.isInteger(age) ||
      age < 18 ||
      age > 127
    ) {
      await fail(
        "Perbarui profil: usia minimal 18 tahun dan tinggi badan 100–255 cm dalam sentimeter bulat.",
      );
      return;
    }
    const session = new ScaleSession(
      {
        heightCm: profile.heightCm,
        lastWeightKg,
        male: profile.sex === "male",
        age: ageOn(profile.birthDate, measuredAt),
        userId,
      },
      this.now,
    );
    const receive = (value: DataView) => {
      // Copy before yielding: native buffers may be reused. Serialize notifications + writes.
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).slice();
      processing = processing
        .then(async () => {
          if (!active()) return;
          const received = session.receive(bytes);
          for (const packet of received.writes) {
            if (!active()) return;
            await this.client.write(
              device.id,
              SERVICE,
              WRITE,
              new DataView(packet.buffer, packet.byteOffset, packet.byteLength),
            );
          }
          for (const event of received.events) {
            if (!active()) return;
            if (event.type === "live")
              update({
                type: "live",
                grams: event.grams,
                status: event.status,
              });
            else if (event.type === "handleMissing")
              await fail(
                "Impedansi belum terbaca. Pegang gagang dengan kedua tangan dan naik tanpa alas kaki, lalu ulangi.",
              );
            else if (event.type === "result") {
              if (event.record.algorithm !== 43) {
                await fail("Versi perhitungan timbangan ini belum didukung.");
                return;
              }
              if (
                event.record.impedances.length !== 10 ||
                event.record.impedances.some(
                  (value) => !Number.isFinite(value) || value <= 0,
                )
              ) {
                await fail(
                  "Pembacaan tubuh belum lengkap. Pegang gagang dengan kedua tangan, lalu ulangi.",
                );
                return;
              }
              const measurement = buildMeasurement({
                measuredAt: new Date(this.now()).toISOString(),
                profile,
                record: event.record,
                packets: session.packets,
              });
              completed = true;
              update({ type: "result", measurement });
              await this.cancel();
            }
          }
        })
        .catch(() =>
          fail(
            "Pengukuran belum berhasil. Periksa posisi kaki dan kedua tangan, lalu ulangi.",
          ),
        );
    };
    try {
      await this.client.initialize({ androidNeverForLocation: true });
      if (!active()) return;
      await this.client.connect(
        device.id,
        () =>
          void fail("Koneksi terputus. Dekatkan HP ke timbangan, lalu ulangi."),
        { timeout: 10_000 },
      );
      if (!active()) {
        await this.client.disconnect(device.id).catch(() => {});
        return;
      }
      const model = await this.client.read(
        device.id,
        uuid("180a"),
        uuid("2a24"),
      );
      if (!active()) return;
      const name = new TextDecoder()
        .decode(
          new Uint8Array(model.buffer, model.byteOffset, model.byteLength),
        )
        .replace(/\0+$/, "");
      if (!/^FG2504WB(?:-A)?$/.test(name)) {
        await fail("Timbangan ini belum didukung. Gunakan LUCA VOSS FG2504WB.");
        return;
      }
      // The scale sends AA as soon as indications are enabled. Session is already ready.
      await this.client.startNotifications(
        device.id,
        SERVICE,
        INDICATE,
        receive,
      );
      if (!active()) return;
      await this.client.startNotifications(device.id, SERVICE, NOTIFY, receive);
      if (active()) update({ type: "connected" });
    } catch {
      await fail(
        "Tidak dapat menghubungkan timbangan. Periksa izin Bluetooth dan pastikan FitDays+ ditutup, lalu ulangi.",
      );
    }
  }
}
