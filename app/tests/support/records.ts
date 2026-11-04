import {
  buildMeasurement,
  fromHex,
  ScaleSession,
  type Profile,
} from "@diascale/core";
import captures from "../../../packages/core/test/fixtures/captures.json" with { type: "json" };
export { captures };
export const profile: Profile = {
  name: "Uji B",
  phone: "81200000000",
  birthDate: "2007-03-01",
  sex: "male",
  heightCm: 147,
  antihypertensive: false,
  familyHistory: true,
  highGlucose: false,
};
export const measuredAt = "2026-11-01T03:10:00.000Z";
export function measurement(id = crypto.randomUUID()) {
  const session = new ScaleSession({
    heightCm: 147,
    lastWeightKg: 45.7,
    male: true,
    age: 19,
    userId: 0x0da5ca1e,
  });
  for (const packet of captures["device-test-b-handshake"]) {
    if (packet.dir !== "in") continue;
    for (const event of session.receive(fromHex(packet.hex)).events)
      if (event.type === "result")
        return buildMeasurement({
          id,
          measuredAt,
          profile,
          record: event.record,
          packets: session.packets,
        });
  }
  throw new Error("No result in device test B");
}
export function memoryDriver(initial: string | null = null) {
  return {
    value: initial,
    fail: false,
    async get() {
      return { value: this.value };
    },
    async set({ value }: { key: string; value: string }) {
      if (this.fail) throw new Error("disk full");
      this.value = value;
    },
  };
}
export const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
