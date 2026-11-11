import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCORE_VERSION, scoreRisk } from "../src/score.ts";

// dataset.csv is the LibreOffice recalculation of dataset/NHANES_DATARASIO_READY.xlsx (sheet "Data").
const [header, ...rows] = readFileSync(new URL("../../../dataset/dataset.csv", import.meta.url), "utf8")
  .trim().split(/\r?\n/).map((line) => line.split(","));
const col = (name: string, from = 0) => {
  const i = header.indexOf(name, from);
  assert.ok(i >= 0, name);
  return i;
};
const scored = col("Visceral");
const c = {
  sex: col("RIAGENDR"), height: col("BMXHT"),
  visceral: scored, fat: col("FATPERSN", scored), bmi: col("BMXBMI", scored),
  muscle: col("MUSCLE"), meds: col("HIPERTENSI"),
  pVisceral: col("RASIO V"), pFat: col("RASIO FATM"), pBmi: col("RASIO BMXBMI"),
  pMuscle: col("RASIO MUS"), pMeds: col("RASIOHIP"), total: col("FINAL_RASIO "), category: col("PARAMETER"),
};

// The dataset has no family-history column and predates diascale@2, so only the unchanged
// components (visceral, medication) are checked against it; the rest is covered by boundary tests.
test("reproduces the unchanged dataset components", () => {
  let checked = 0;
  for (const r of rows) {
    if (!r[c.total]) continue;
    const result = scoreRisk({
      male: r[c.sex] === "1",
      heightCm: Number(r[c.height]),
      visceral: Number(r[c.visceral]),
      fatPercent: Number(r[c.fat]),
      bmi: Number(r[c.bmi]),
      muscleKg: Number(r[c.muscle]),
      antihypertensive: r[c.meds] === "1",
      familyHistory: false,
    });
    assert.equal(result.points.visceral, Number(r[c.pVisceral]), `row ${r[0]}`);
    assert.equal(result.points.antihypertensive, Number(r[c.pMeds]), `row ${r[0]}`);
    checked++;
  }
  assert.equal(checked, rows.filter((r) => r[c.total]).length);
  assert.ok(checked > 7900, `${checked} rows`);
});

const base = { male: true, heightCm: 170, visceral: 90, fatPercent: 15, bmi: 20, muscleKg: 30, antihypertensive: false, familyHistory: false };

test("thresholds sit on the documented boundaries", () => {
  const p = (over: Partial<typeof base>) => scoreRisk({ ...base, ...over }).points;
  assert.deepEqual([99.9, 100, 120, 140, 160].map((visceral) => p({ visceral }).visceral), [0, 10, 20, 30, 40]);
  assert.deepEqual([22.9, 23, 25].map((bmi) => p({ bmi }).bmi), [0, 9, 18]);
  assert.deepEqual([19.9, 20, 25, 30, 35].map((fatPercent) => p({ fatPercent }).fat), [0, 4, 8, 13, 18]);
  assert.deepEqual([29.9, 30, 35, 40, 45].map((fatPercent) => p({ male: false, fatPercent }).fat), [0, 4, 8, 13, 18]);
  // height 100 cm makes SMI equal to muscle mass
  assert.deepEqual([6.9, 7, 8.5].map((muscleKg) => p({ heightCm: 100, muscleKg }).muscle), [14, 7, 0]);
  assert.deepEqual([5.6, 5.7, 6.5].map((muscleKg) => p({ male: false, heightCm: 100, muscleKg }).muscle), [14, 7, 0]);
  assert.equal(p({ antihypertensive: true }).antihypertensive, 5);
  assert.equal(p({ familyHistory: true }).family, 5);
});

test("category bands are Aman below 40, Meningkat 40–74, Waspada from 75", () => {
  const category = (visceral: number, bmi: number, antihypertensive: boolean) =>
    scoreRisk({ ...base, visceral, bmi, antihypertensive });
  assert.equal(category(120, 23, false).category, "Aman"); // 20 + 9 = 29
  assert.equal(category(170, 20, false).category, "Meningkat"); // 40
  const high = scoreRisk({ ...base, visceral: 170, bmi: 25, fatPercent: 35, antihypertensive: false });
  assert.equal(high.total, 40 + 18 + 18 + 0);
  assert.equal(high.category, "Waspada");
  assert.equal(scoreRisk({ ...base, visceral: 170, bmi: 25, fatPercent: 24, muscleKg: 60 }).total, 40 + 18 + 4);
  assert.equal(SCORE_VERSION, "diascale@2");
});
