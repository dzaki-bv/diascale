import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromHex } from "../src/protocol.ts";
import { ScaleSession } from "../src/session.ts";
import { BODY_VERSION } from "../src/body.ts";
import { SCORE_VERSION } from "../src/score.ts";
import { ageOn, buildMeasurement, rescore, type Profile } from "../src/measurement.ts";

const captures = JSON.parse(readFileSync(new URL("./fixtures/captures.json", import.meta.url), "utf8"));
const profile: Profile = {
  name: "Uji B", phone: "081200000000", birthDate: "2007-03-01", sex: "male", heightCm: 147,
  antihypertensive: false, familyHistory: true, highGlucose: false,
};
const measuredAt = "2026-11-01T03:10:00.000Z";

function deviceTestB() {
  const session = new ScaleSession({ heightCm: 147, lastWeightKg: 45.7, male: true, age: 19, userId: 0x0da5ca1e });
  let record;
  for (const p of captures["device-test-b-handshake"])
    if (p.dir === "in")
      for (const e of session.receive(fromHex(p.hex)).events) if (e.type === "result") record = e.record;
  assert.ok(record);
  return { record, packets: session.packets };
}

test("device test B becomes a complete measurement record", () => {
  const { record, packets } = deviceTestB();
  const m = buildMeasurement({ id: "c1", measuredAt, profile, record, packets });
  assert.equal(m.id, "c1");
  assert.equal(m.measuredAt, measuredAt);
  assert.deepEqual(m.profile, profile);
  assert.notEqual(m.profile, profile, "the profile is a snapshot");
  assert.deepEqual(m.inputs, {
    weightKg: 45.7, heightCm: 147, age: 19, male: true,
    impedances: [24.8, 427.3, 407.5, 366.0, 371.0, 20.8, 368.0, 348.4, 311.4, 318.3],
  });
  // bfr 23.9 %, waist 74.6 cm from the body composition
  assert.deepEqual(m.numbers, { bmi: 21.1, fatMassKg: 10.9, visceral: 67.3, muscleKg: 16.0 });
  assert.equal(m.fatPercent, 23.9);
  assert.equal(m.waistCm, 74.6);
  assert.deepEqual(m.score, {
    points: { visceral: 0, fat: 4, bmi: 0, muscle: 7, antihypertensive: 0, family: 5 }, total: 16, category: "Aman",
  });
  assert.equal(m.comparison.rfmFatPercent, 24.6); // 64 − 20 × 147 / 74.6
  assert.equal(m.comparison.body.vfal, 3);
  assert.equal(m.comparison.body.hip, Math.fround(87.7));
  assert.deepEqual(m.packets, packets);
  assert.notEqual(m.packets, packets, "later session packets do not leak in");
  assert.deepEqual(m.versions, { body: BODY_VERSION, score: SCORE_VERSION });
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m, "the record is plain JSON");
});

test("female profiles and medication flow into the score", () => {
  const { record, packets } = deviceTestB();
  const m = buildMeasurement({
    id: "c2", measuredAt, record, packets, profile: { ...profile, sex: "female", antihypertensive: true },
  });
  assert.equal(m.inputs.male, false);
  assert.equal(m.score.points.antihypertensive, 5);
  assert.equal(m.comparison.rfmFatPercent, 36.6); // 76 − 20 × 147 / waist
});

test("a weighing the body composition rejects builds no record", () => {
  const { record, packets } = deviceTestB();
  assert.throws(
    () => buildMeasurement({ id: "c3", measuredAt, record, packets, profile: { ...profile, heightCm: 90 } }),
    /body composition error 1/,
  );
});

test("age counts whole years up to the measurement day", () => {
  assert.equal(ageOn("2007-11-01", "2026-11-01T03:00:00Z"), 19);
  assert.equal(ageOn("2007-11-02", "2026-11-01T03:00:00Z"), 18);
});

test("rescore upgrades an older score from the stored numbers and profile snapshot", () => {
  const { record, packets } = deviceTestB();
  const current = buildMeasurement({ id: "c1", measuredAt, profile, record, packets });
  const old = structuredClone(current);
  old.score = {
    points: { visceral: 0, fat: 5, bmi: 0, muscle: 7, antihypertensive: 0 }, total: 12, category: "Aman",
  } as typeof old.score;
  old.versions.score = "diascale@1";
  const upgraded = rescore(old);
  assert.deepEqual(upgraded, current);
  assert.equal(old.versions.score, "diascale@1", "the input is not mutated");
  assert.equal(rescore(current), current, "current records are returned unchanged");
});
