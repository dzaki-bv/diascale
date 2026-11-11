import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex, checksum } from "@diascale/core";
import {
  ScaleAdapter,
  supportedAdvertisement,
  NOTIFY,
  INDICATE,
  type ScaleUpdate,
} from "../src/scale.ts";
import { captures, profile, measuredAt, settle } from "./support/records.ts";

const view = (hex: string) => {
  const bytes = fromHex(hex);
  return new DataView(bytes.buffer);
};
const advert = (id = "scale") => ({
  device: { deviceId: id, name: "MY_SCALE" },
  manufacturerData: { [0x2cac]: view("A2EBCDF4656033711E1A0A012B00004400") },
});
class FakeBle {
  calls: string[] = [];
  writes: string[] = [];
  callbacks = new Map<string, (data: DataView) => void>();
  scanCallback?: (result: ReturnType<typeof advert>) => void;
  disconnected?: () => void;
  model = "FG2504WB-A";
  async initialize() {
    this.calls.push("initialize");
  }
  async requestLEScan(
    _options: unknown,
    callback: (result: ReturnType<typeof advert>) => void,
  ) {
    this.calls.push("scan");
    this.scanCallback = callback;
  }
  async stopLEScan() {
    this.calls.push("stop-scan");
  }
  async connect(_id: string, disconnected?: () => void) {
    this.calls.push("connect");
    this.disconnected = disconnected;
  }
  async disconnect() {
    this.calls.push("disconnect");
  }
  async read() {
    const bytes = new TextEncoder().encode(this.model);
    return new DataView(bytes.buffer);
  }
  async write(
    _id: string,
    _service: string,
    _characteristic: string,
    value: DataView,
  ) {
    this.writes.push(
      toHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    );
  }
  async startNotifications(
    _id: string,
    _service: string,
    characteristic: string,
    callback: (data: DataView) => void,
  ) {
    this.calls.push(characteristic);
    this.callbacks.set(characteristic, callback);
  }
  async stopNotifications() {}
}
const device = { id: "scale", name: "MY_SCALE", rssi: -45 };
async function weighing(t: { after: (fn: () => Promise<void>) => void }) {
  const ble = new FakeBle();
  const adapter = new ScaleAdapter(ble, () => new Date(measuredAt).getTime());
  const events: ScaleUpdate[] = [];
  t.after(() => adapter.cancel());
  await adapter.measure(device, profile, 0x0da5ca1e, 45.7, (event) =>
    events.push(event),
  );
  return { ble, adapter, events };
}

test("filters the captured advertisement by subtype/electrodes/algorithm rather than its name", () => {
  assert.equal(supportedAdvertisement(advert()), true);
  assert.equal(supportedAdvertisement({ device: advert().device }), false);
  const other = advert();
  other.manufacturerData[0x2cac].setUint8(6, 0x32);
  assert.equal(supportedAdvertisement(other), false);
  const unsupported = advert();
  unsupported.manufacturerData[0x2cac].setUint8(12, 42);
  assert.equal(supportedAdvertisement(unsupported), false);
});

test("scan deduplicates supported devices and cleans up its native subscription", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ble = new FakeBle();
  const adapter = new ScaleAdapter(ble);
  t.after(() => adapter.cancel());
  const scan = adapter.scan();
  await settle();
  ble.scanCallback!(advert());
  ble.scanCallback!(advert());
  ble.scanCallback!({
    device: { deviceId: "bad", name: "MY_SCALE" },
    manufacturerData: {},
  } as ReturnType<typeof advert>);
  t.mock.timers.tick(1500);
  const devices = await scan;
  assert.equal(devices.length, 1);
  assert.ok(ble.calls.includes("stop-scan"));
});

test("scan then connect initializes the native client only once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ble = new FakeBle();
  const adapter = new ScaleAdapter(ble, () => new Date(measuredAt).getTime());
  t.after(() => adapter.cancel());
  const scan = adapter.scan();
  await settle();
  ble.scanCallback!(advert());
  t.mock.timers.tick(1500);
  const [found] = await scan;
  await adapter.measure(found, profile, 0x0da5ca1e, 45.7, () => {});
  assert.equal(ble.calls.filter((call) => call === "initialize").length, 1);
});

test("subscribes FFB3 before FFB2 and replays real packets to one archived core result", async (t) => {
  const { ble, events } = await weighing(t);
  assert.ok(ble.calls.indexOf(INDICATE) < ble.calls.indexOf(NOTIFY));
  for (const packet of captures["device-test-b-handshake"]) {
    if (packet.dir !== "in") continue;
    ble.callbacks.get(packet.char === "FFB3" ? INDICATE : NOTIFY)!(
      view(packet.hex),
    );
    await settle();
  }
  const results = events.filter((event) => event.type === "result");
  assert.equal(results.length, 1);
  const m = results[0].measurement;
  assert.deepEqual(m.numbers, {
    bmi: 21.1,
    fatMassKg: 10.9,
    visceral: 67.3,
    muscleKg: 16,
  });
  assert.equal(m.score.total, 16);
  assert.equal(m.profile.name, profile.name);
  assert.equal(
    m.packets.filter((packet) => packet.dir === "out").length,
    ble.writes.length,
  );
  assert.ok(ble.calls.includes("disconnect"));
});

test("cancellation ignores delayed packets and cancels a scan pending native initialization", async (t) => {
  const { ble, adapter, events } = await weighing(t);
  await adapter.cancel();
  const packet = captures["device-test-b-handshake"].find(
    (packet) => packet.hex.slice(8, 10) === "A7",
  )!;
  ble.callbacks.get(NOTIFY)!(view(packet.hex));
  await settle();
  assert.equal(events.filter((event) => event.type === "result").length, 0);
  let release!: () => void;
  const fresh = new FakeBle();
  fresh.initialize = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = new ScaleAdapter(fresh);
  const scan = pending.scan();
  await settle();
  await pending.cancel();
  release();
  assert.deepEqual(await scan, []);
});

test("missing impedances, disconnect and timeout produce no saved result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const missing = await weighing(t);
  const bytes = fromHex(
    "57002300A76AE6424A2B00B284000A00000000000000000000000000000000000000000DA5CA1E00",
  );
  bytes[bytes.length - 1] = checksum(bytes.subarray(4, bytes.length - 1));
  missing.ble.callbacks.get(NOTIFY)!(new DataView(bytes.buffer));
  await settle();
  assert.equal(missing.events.at(-1)!.type, "failure");
  const disconnected = await weighing(t);
  disconnected.ble.disconnected!();
  await settle();
  assert.equal(disconnected.events.at(-1)!.type, "failure");
  const timeout = await weighing(t);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(timeout.events.at(-1)!.type, "failure");
  for (const run of [missing, disconnected, timeout])
    assert.equal(
      run.events.filter((event) => event.type === "result").length,
      0,
    );
});

test("rejects an unsupported model before enabling measurement notifications", async (t) => {
  const ble = new FakeBle();
  ble.model = "OTHER";
  const adapter = new ScaleAdapter(ble);
  t.after(() => adapter.cancel());
  const events: ScaleUpdate[] = [];
  await adapter.measure(device, profile, 123, 50, (event) =>
    events.push(event),
  );
  assert.equal(events[0].type, "failure");
  assert.equal(ble.callbacks.size, 0);
});

test("cancel during connection cleanup cannot restart a scan afterward", async (t) => {
  const { ble, adapter } = await weighing(t);
  let release!: () => void;
  ble.disconnect = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const before = ble.calls.filter((call) => call === "initialize").length;
  const pending = adapter.scan();
  await settle();
  const cancelled = adapter.cancel();
  release();
  await cancelled;
  assert.deepEqual(await pending, []);
  assert.equal(
    ble.calls.filter((call) => call === "initialize").length,
    before,
  );
});

test("incomplete impedances and a different algorithm never become a successful archive", async (t) => {
  for (const field of ["algorithm", "impedance"]) {
    const run = await weighing(t);
    const bytes = fromHex(
      "57002300A76AE6424A2B00B284000A00F810B10FEB0E4C0E7E00D00E600D9C0C2A0C6F0DA5CA1E19",
    );
    if (field === "algorithm") bytes[9] = 42;
    else {
      bytes[15] = 0;
      bytes[16] = 0;
    }
    bytes[bytes.length - 1] = checksum(bytes.subarray(4, bytes.length - 1));
    run.ble.callbacks.get(NOTIFY)!(new DataView(bytes.buffer));
    await settle();
    assert.equal(run.events.at(-1)!.type, "failure");
    assert.equal(
      run.events.filter((event) => event.type === "result").length,
      0,
    );
  }
});
