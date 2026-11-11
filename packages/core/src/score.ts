// Diabetes type 2 risk score (docs/scale-integration-spec.md), following the
// formulas in dataset/NHANES_DATARASIO_READY.xlsx. Callers pass the displayed, rounded values.

export const SCORE_VERSION = "diascale@2";

export type RiskCategory = "Aman" | "Meningkat" | "Waspada";

export interface ScoreInput {
  male: boolean;
  heightCm: number;
  visceral: number;
  fatPercent: number;
  bmi: number;
  muscleKg: number;
  antihypertensive: boolean;
  familyHistory: boolean;
}

export interface RiskScore {
  points: { visceral: number; fat: number; bmi: number; muscle: number; antihypertensive: number; family: number };
  total: number;
  category: RiskCategory;
}

/** Points for the first cut-off the value is below, else the last entry. */
function band(value: number, cutoffs: number[], points: number[]): number {
  const i = cutoffs.findIndex((cutoff) => value < cutoff);
  return points[i < 0 ? cutoffs.length : i];
}

export function scoreRisk(input: ScoreInput): RiskScore {
  const smi = input.muscleKg / (input.heightCm / 100) ** 2;
  const points = {
    visceral: band(input.visceral, [100, 120, 140, 160], [0, 10, 20, 30, 40]),
    fat: band(input.fatPercent, input.male ? [20, 25, 30, 35] : [30, 35, 40, 45], [0, 4, 8, 13, 18]),
    bmi: band(input.bmi, [23, 25], [0, 9, 18]),
    muscle: band(smi, input.male ? [7, 8.5] : [5.7, 6.5], [14, 7, 0]),
    antihypertensive: input.antihypertensive ? 5 : 0,
    family: input.familyHistory ? 5 : 0,
  };
  const total = points.visceral + points.fat + points.bmi + points.muscle + points.antihypertensive + points.family;
  const category = total < 40 ? "Aman" : total >= 75 ? "Waspada" : "Meningkat";
  return { points, total, category };
}
