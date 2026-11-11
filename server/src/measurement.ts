import type { Measurement } from "@diascale/core";
import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);
const number = z.number().finite();
const date = z.iso.date();

// Validate the archive boundary without replacing the client's versioned results.
// Unknown object fields are retained so the full submitted JSON can be archived.
export const measurementSchema: z.ZodType<Measurement> = z
  .looseObject({
    id: text(128),
    measuredAt: z.iso.datetime({ offset: true }),
    profile: z.looseObject({
      name: text(200),
      phone: text(32),
      birthDate: date,
      sex: z.enum(["male", "female"]),
      heightCm: number.positive(),
      antihypertensive: z.boolean(),
      familyHistory: z.boolean(),
      highGlucose: z.boolean(),
    }),
    inputs: z.looseObject({
      weightKg: number.positive(),
      impedances: z.array(number.positive()).length(10),
      heightCm: number.positive(),
      age: number.int().min(18).max(127),
      male: z.boolean(),
    }),
    numbers: z.looseObject({
      bmi: number.positive(),
      fatMassKg: number.nonnegative(),
      visceral: number,
      muscleKg: number.nonnegative(),
    }),
    fatPercent: number.min(0).max(100),
    waistCm: number.positive(),
    score: z.looseObject({
      points: z.looseObject({
        visceral: number.int().min(0).max(40),
        fat: number.int().min(0).max(20),
        bmi: number.int().min(0).max(20),
        muscle: number.int().min(0).max(15),
        antihypertensive: number.int().min(0).max(5),
        family: number.int().min(0).max(5).optional(), // absent before diascale@2
      }),
      total: number.int().min(0).max(100),
      category: z.enum(["Aman", "Meningkat", "Waspada"]),
    }),
    comparison: z.looseObject({
      rfmFatPercent: number,
      body: z.record(z.string(), number).and(z.object({ error: z.literal(0) })),
    }),
    packets: z
      .array(
        z.looseObject({
          dir: z.enum(["in", "out"]),
          hex: z
            .string()
            .regex(/^(?:[0-9a-fA-F]{2})+$/)
            .max(2048),
        }),
      )
      .min(1)
      .max(1024),
    versions: z.looseObject({ body: text(64), score: text(64) }),
  })
  .refine(
    (m) =>
      m.inputs.heightCm === m.profile.heightCm &&
      m.inputs.male === (m.profile.sex === "male"),
    "profile and inputs disagree",
  );
