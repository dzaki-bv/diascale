// One saved measurement: what the phone stores and the server archives
// (docs/scale-integration-spec.md, "Data and server"). Results are never recomputed later.

import { BODY_VERSION, calcBody, type BodyComposition } from "./body.ts";
import type { ScaleRecord } from "./protocol.ts";
import { SCORE_VERSION, scoreRisk, type RiskScore } from "./score.ts";
import type { RawPacket } from "./session.ts";

export interface Profile {
  name: string;
  phone: string;
  /** YYYY-MM-DD */
  birthDate: string;
  sex: "male" | "female";
  heightCm: number;
  antihypertensive: boolean;
  familyHistory: boolean;
  highGlucose: boolean;
}

export interface Measurement {
  /** Client-generated; the server ignores a resent id. */
  id: string;
  /** ISO 8601 */
  measuredAt: string;
  profile: Profile;
  inputs: { weightKg: number; impedances: number[]; heightCm: number; age: number; male: boolean };
  /** The four required numbers, rounded as displayed. */
  numbers: { bmi: number; fatMassKg: number; visceral: number; muscleKg: number };
  fatPercent: number;
  waistCm: number;
  score: RiskScore;
  comparison: { rfmFatPercent: number; body: BodyComposition };
  packets: RawPacket[];
  versions: { body: string; score: string };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Whole years from the birth date to the measurement's local calendar day. */
export function ageOn(birthDate: string, measuredAt: string): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  const at = new Date(measuredAt);
  const birthdayPassed = at.getMonth() + 1 > m || (at.getMonth() + 1 === m && at.getDate() >= d);
  return at.getFullYear() - y - (birthdayPassed ? 0 : 1);
}

/** Throws when the body composition rejects the weighing; nothing is saved then. */
export function buildMeasurement({ id = crypto.randomUUID(), measuredAt, profile, record, packets }: {
  id?: string;
  measuredAt: string;
  profile: Profile;
  record: ScaleRecord;
  packets: RawPacket[];
}): Measurement {
  const male = profile.sex === "male";
  const inputs = {
    weightKg: record.grams / 1000, impedances: [...record.impedances],
    heightCm: profile.heightCm, age: ageOn(profile.birthDate, measuredAt), male,
  };
  const body = calcBody(inputs);
  if (body.error) throw new Error(`body composition error ${body.error}`);

  const fatPercent = round1(body.bfr);
  const waistCm = round1(body.waist);
  const weight = inputs.weightKg;
  const heightM = profile.heightCm / 100;
  const fatMass = (weight * fatPercent) / 100;
  const numbers = {
    bmi: round1(weight / heightM ** 2),
    fatMassKg: round1(fatMass),
    visceral: round1(-182.65 + 3.35 * waistCm),
    muscleKg: round1(0.46 * (weight - fatMass)),
  };
  const score = scoreRisk({
    male, heightCm: profile.heightCm, visceral: numbers.visceral, fatPercent, bmi: numbers.bmi,
    muscleKg: numbers.muscleKg, antihypertensive: profile.antihypertensive,
  });
  return {
    id, measuredAt, profile: { ...profile }, inputs, numbers, fatPercent, waistCm, score,
    comparison: { rfmFatPercent: round1((male ? 64 : 76) - (20 * profile.heightCm) / waistCm), body },
    packets: packets.map((p) => ({ ...p })),
    versions: { body: BODY_VERSION, score: SCORE_VERSION },
  };
}
