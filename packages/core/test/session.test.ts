import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAck, buildProfile, buildUserList, checksum, fromHex, parseLive, parsePacket, parseRecord, toHex,
} from "../src/protocol.ts";
import { ScaleSession, MEASUREMENT_TIMEOUT_MS } from "../src/session.ts";

const captures = JSON.parse(readFileSync(new URL("./fixtures/captures.json", import.meta.url), "utf8"));
const DIASCALE_ID = 0x0da5ca1e;
const profile = { heightCm: 147, lastWeightKg: 45.7, male: true, age: 19, userId: DIASCALE_ID };

test("checksum is the payload sum masked to five bits for every captured packet", () => {
  for (const seq of Object.values(captures) as { hex: string }[][])
    for (const { hex } of seq) {
      const bytes = fromHex(hex);
      assert.equal(checksum(bytes.subarray(4, bytes.length - 1)), bytes.at(-1), hex);
      assert.ok(parsePacket(bytes), hex);
    }
});

test("live weight decodes grams and status", () => {
  assert.deepEqual(parseLive(parsePacket(fromHex("8B000700A2010000B2840019"))!), { status: "measuring", grams: 45700 });
  assert.deepEqual(parseLive(parsePacket(fromHex("AA000700A2030000B284001B"))!), { status: "stable", grams: 45700 });
  assert.deepEqual(parseLive(parsePacket(fromHex("B4000700A2000000B2840018"))!), { status: "off", grams: 45700 });
});

test("final record decodes time, weight, impedances in ohm and user id", () => {
  const record = parseRecord(parsePacket(fromHex(
    "57002300A76AE6424A2B00B284000A00F810B10FEB0E4C0E7E00D00E600D9C0C2A0C6F0DA5CA1E19"))!);
  assert.deepEqual(record, {
    stored: false, time: 0x6ae6424a, algorithm: 0x2b, grams: 45700,
    impedances: [24.8, 427.3, 407.5, 366.0, 371.0, 20.8, 368.0, 348.4, 311.4, 318.3],
    userId: DIASCALE_ID,
  });
});

test("handshake packets match what the scale accepted in device test B", () => {
  assert.equal(toHex(buildAck(0, 0x52)), "00000300B0520002");
  assert.equal(toHex(buildProfile(1, 0x6ae64235, profile)), "01001A00C06AE6423501A4019311DA93138813882F0DA5CA1E0101026B6915");
  assert.equal(toHex(buildUserList(2, profile)), "02001500C101019311DA93138813880F0DA5CA1E0101026B690B");
});

function replay(name: string, startMs: number) {
  const session = new ScaleSession(profile, () => startMs);
  const writes: string[] = [];
  const events = [];
  for (const p of captures[name]) {
    if (p.dir !== "in") continue;
    const out = session.receive(fromHex(p.hex));
    writes.push(...out.writes.map(toHex));
    events.push(...out.events);
  }
  return { session, writes, events };
}

test("device test B replays to the same writes and one accepted result", () => {
  const { writes, events } = replay("device-test-b-handshake", 0x6ae64235 * 1000);
  const recorded = captures["device-test-b-handshake"].filter((p: { dir: string }) => p.dir === "out").map((p: { hex: string }) => p.hex);
  assert.deepEqual(writes, recorded);
  const results = events.filter((e) => e.type === "result");
  assert.equal(results.length, 1);
  assert.equal(results[0].record.grams, 45700);
  assert.ok(events.some((e) => e.type === "live" && e.status === "stable"));
});

test("records tagged with another user id are acknowledged but never accepted (device test A)", () => {
  const { writes, events } = replay("device-test-a-no-handshake", 0);
  assert.equal(events.filter((e) => e.type === "result" || e.type === "handleMissing").length, 0);
  const finals = captures["device-test-a-no-handshake"].filter((p: { hex: string }) => p.hex.slice(8, 10) === "A7");
  const acks = writes.filter((hex) => hex.slice(8, 10) === "B0");
  assert.ok(finals.length >= 3, "the scale repeats unacknowledged records");
  assert.equal(acks.length, finals.length + 1, "device info plus every repeated final record");
});

test("a final record without impedances asks for the handle", () => {
  const session = new ScaleSession(profile, () => 0);
  const empty = fromHex("57002300A76AE6424A2B00B284000A00000000000000000000000000000000000000000DA5CA1E00");
  empty[empty.length - 1] = checksum(empty.subarray(4, empty.length - 1));
  const { events } = session.receive(empty);
  assert.deepEqual(events.map((e) => e.type), ["handleMissing"]);
});

test("the session times out after 60 s without a result", () => {
  let now = 0;
  const session = new ScaleSession(profile, () => now);
  now = MEASUREMENT_TIMEOUT_MS;
  assert.equal(session.timedOut(), false);
  now += 1;
  assert.equal(session.timedOut(), true);
});
