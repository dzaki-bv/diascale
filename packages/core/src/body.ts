// Body composition of the LUCA VOSS FG2504WB: port of research/scale/tools/wla43_clean.py
// (iComon ICBodyFatAlgorithmWLA43::calc) with girth estimation always on and adult users only.
// Arithmetic mirrors the reference: Math.fround where it used float32, fma where it used fmadd.
// Results must equal test/fixtures/body.json exactly; change the reference and re-export instead.

import tables from "./tables.json" with { type: "json" };

export const BODY_VERSION = "wla43@1";

export interface BodyInput {
  weightKg: number;
  heightCm: number;
  male: boolean;
  age: number;
  /** Ohm, scale order: trunk, LA, RA, LL, RL at 20 kHz, then the same at 100 kHz. */
  impedances: number[];
}

/**
 * error 0: all metrics; 1: height or weight out of range; 2: impedance too low; 3: corrected trunk negative.
 * With an error only bmi, the standards and the ranges are present. Key names follow the reference.
 */
export type BodyComposition = Record<string, number> & { error: number };

const f32 = Math.fround;
/** Python's math.trunc: an integer, so never -0. */
const trunc = (x: number) => Math.trunc(x) + 0;

function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const bits = new BigUint64Array(new Float64Array([x]).buffer)[0];
  const exp = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & 0xfffffffffffffn;
  if (exp !== 0) mantissa |= 1n << 52n;
  return [bits >> 63n ? -mantissa : mantissa, (exp || 1) - 1075];
}

/** a × b + c with a single rounding (exact BigInt sum, rounded by Number()). */
export function fma(a: number, b: number, c: number): number {
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  const sum = ((ma * mb) << BigInt(ep - e)) + (mc << BigInt(ec - e));
  return Number(sum) * 2 ** e;
}

function fmodf(a: number, b: number): number {
  return f32(a % b);
}

/** The library's 1-decimal rounding: fraction digit rounded half-up (> .5), integer part of y. */
function r1(x: number, y = x): number {
  const t = f32(fmodf(f32(x), 1) * 10);
  const sel = fmodf(t, 1) > 0.5 ? f32(t + 1) : t;
  return f32(f32(f32(trunc(sel)) / 10) + f32(trunc(y)));
}

function h2(h: number): number {
  const hm = f32(h / 100);
  return f32(hm * hm);
}

function stdBmi(male: boolean): number {
  return male ? 22 : 21;
}

function stdSmm(h: number, male: boolean): number {
  return (male ? tables.smmMale : tables.smmFemale)[Math.min(Math.max(h, 0), 300)];
}

const stdWeight = (h: number, male: boolean) => f32(h2(h) * stdBmi(male));
const stdBfm = (h: number, male: boolean) => f32((male ? 0.15 : 0.23) * stdWeight(h, male));
const stdFfm = (h: number, male: boolean) => f32((male ? 0.85 : 0.77) * stdWeight(h, male));

function bodyScore(h: number, weight: number, male: boolean, pbf: number): number {
  const w = f32(weight);
  const fm = f32((pbf / 100) * w);
  const ffm = f32(w - fm);
  const sw = stdWeight(h, male);
  const dFfm = f32(ffm - f32((male ? 0.85 : 0.77) * sw)) + 80;
  const dFm = f32(fm - f32((male ? 0.15 : 0.23) * sw));
  return trunc(dFm < 0 ? fma(dFm, 0.983, dFfm) : fma(dFm, -0.958, dFfm));
}

function armBalance(a: number, b: number): number {
  const d = Math.abs(f32(a - b));
  return d >= 10 ? 2 : d >= 6 ? 1 : 0;
}

function legBalance(a: number, b: number): number {
  const d = Math.abs(f32(a - b));
  return d >= 5 ? 2 : d >= 3 ? 1 : 0;
}

function armLegBalance(la: number, ra: number, ll: number, rl: number): number {
  const arm = trunc(f32(f32(f32(f32(la + ra) * 0.5) - 100) / 15));
  const leg = trunc(f32(f32(f32(f32(ll + rl) * 0.5) - 100) / 10));
  const d = Math.abs(arm - leg);
  return d >= 2 ? 2 : d === 1 ? 1 : 0;
}

function bodyType(male: boolean, bmi: number, pbf: number): number {
  const [lo, mid, hi] = male ? [10, 15, 20] : [18, 23, 28];
  if (bmi < 18.5 && pbf < lo) return 0;
  if (pbf < hi && bmi < 18.5 && pbf >= lo) return 1;
  if (bmi >= 18.5 && bmi < 22 && pbf < lo) return 2;
  if (bmi >= 18.5 && bmi < 22 && pbf >= lo && pbf < mid) return 3;
  if (bmi >= 22 && bmi < 25 && pbf < mid) return 4;
  if (pbf < hi && bmi >= 18.5 && bmi < 25 && pbf >= mid) return 5;
  if (bmi >= 25 && pbf < mid) return 6;
  if (pbf < hi && bmi >= 25 && pbf >= mid) return 7;
  if (bmi >= 25 && pbf >= hi) return 8;
  if (bmi >= 22 && bmi < 25 && pbf >= hi) return 9;
  return pbf >= hi && bmi < 22 ? 10 : 0;
}

// ICBodyFatAlgorithmWLA43::calcBF coefficients (float32 bit patterns).
const BF = Array.from(new Float32Array(new Uint32Array([
  0x3e90ee3f, 0x3aa2966c, 0xbb25e002, 0x3f62343d, 0x3f970c2c, 0xc195bb17, 0x405bc085, 0xbd2e099f,
  0xbf43bc0b, 0xc1de8624, 0x4316754d, 0x4441b6a6, 0xc469bb7a, 0xbf0cee01, 0x3df3e45d, 0x3fa72e7f,
  0xbfb69dfb, 0xc2ae3535,
]).buffer));

function par(a: number, b: number): number {
  return f32(f32(a * b) / f32(a + b));
}

/** z has the trunk values already corrected. */
function fatMassRaw(weight: number, height: number, bmi: number, z: number[]): number {
  const [t20, a1, a2, l1, l2, t100, a1h, a2h, l1h, l2h] = z.map(f32);
  const w = f32(weight);
  const h = f32(height);
  const hh = f32(h * h);
  const arm20 = f32(a1 + a2);
  const arm100 = f32(a1h + a2h);
  const leg20 = f32(l1 + l2);
  const leg100 = f32(l1h + l2h);
  const z20 = f32(f32(par(a1, a2) + t20) + par(l1, l2));
  const z100 = f32(f32(par(a1h, a2h) + t100) + par(l1h, l2h));
  const limbs = f32(f32(f32(arm20 + arm100) * 0.5) + f32(f32(leg20 + leg100) * 0.5));
  let r = f32(fma(w, BF[0], 0));
  r = f32(fma(f32(w * w), BF[1], r));
  r = f32(fma(hh, BF[2], r));
  r = f32(fma(h, BF[3], r));
  r = f32(fma(f32(bmi), BF[4], r));
  const features = [
    limbs / hh, hh / limbs, hh / z20, hh / z100, arm20 / hh, arm100 / hh, leg20 / hh, leg100 / hh,
    hh / arm20, hh / arm100, hh / leg20, hh / leg100,
  ];
  features.forEach((x, i) => (r = f32(fma(f32(x), BF[5 + i], r))));
  return f32(r + BF[17]);
}

/** ICAlgCommon::calcWLA39: circumferences in cm (1 decimal) and WHR = waist / hip (2 decimals). */
function girth(weight: number, height: number, bmi: number, z: number[]) {
  const [t20, la20, ra20, ll20, rl20, t100, la100, ra100, ll100, rl100] = z.map(f32);
  const H = f32(height);
  const W = f32(weight);
  const B = f32(bmi);
  const HH = H * H;
  const fsum = (values: number[]) => values.reduce((s, v) => f32(s + v), 0);
  const s20 = fsum([ra20, la20, t20, rl20, ll20]);
  const s100 = fsum([ra100, la100, t100, rl100, ll100]);
  const den20 = t20 + par(ra20, la20) + par(rl20, ll20);
  const den100 = t100 + par(ra100, la100) + par(rl100, ll100);
  const segments = [t20, ra20, la20, rl20, ll20, t100, ra100, la100, rl100, ll100];
  const features = [
    W, W * W, f32(H * H), H, B, s20 / H / H, s100 / H / H, HH / den20, HH / den100,
    ...segments.map((v) => v / H / H), ...segments.map((v) => HH / v),
  ];
  const raw: Record<string, number> = {};
  for (const [name, { constant, coefficients }] of Object.entries(tables.girth)) {
    let acc = 0;
    coefficients.forEach((c, i) => (acc = fma(features[i], c, acc)));
    raw[name] = f32(acc + constant);
  }
  const whr = r1(f32(f32(raw.waist / raw.hip) * 10)) / 10;
  const out: Record<string, number> = { whr };
  for (const [name, v] of Object.entries(raw)) out[name] = r1(v);
  return out;
}

export function calcBody(input: BodyInput): BodyComposition {
  const { male, age } = input;
  const w = input.weightKg;
  const h = trunc(input.heightCm);
  const bmiRaw = (w * 10000) / f32(h * h);
  const bmi = r1(f32(bmiRaw), bmiRaw);

  // standards and ranges (computed before input validation, like the library)
  const sFfmRaw = stdFfm(h, male);
  const sBmr = trunc(f32(fma(sFfmRaw, 21.6, 370)));
  const sW = r1(stdWeight(h, male));
  const sBfm = r1(stdBfm(h, male));
  const sFfm = r1(sFfmRaw);
  const sBmi = r1(stdBmi(male));
  const sSmm = r1(stdSmm(h, male));
  const hm2 = (h * h) / 10000;
  const obesity = trunc(r1(f32((w / sW) * 100), (w / sW) * 100));
  const wMax = 1.15 * (hm2 * sBmi);
  const wMin = 0.85 * (hm2 * sBmi);
  const bfmMax = (male ? 1.6 : 1.395) * sBfm;
  const bfmMin = (male ? 0.8 : 0.87) * sBfm;
  const leanMax = wMax - bfmMax;
  const leanMin = wMin - bfmMin;
  const range = (v: number) => r1(f32(v), v);
  const standards = {
    bmi, weightStandard: sW, bfmStandard: sBfm, bfpStandard: r1(male ? 15 : 23), bmiStandard: sBmi,
    smmStandard: sSmm, ffmStandard: sFfm, bmrStandard: sBmr, bmiOverweight: r1(30), bmiHigh: r1(25),
    bfmMax: range(bfmMax), bfmMin: range(bfmMin), bfpMax: male ? 20 : 28, bfpMin: male ? 10 : 18,
    weightMax: range(wMax), weightMin: range(wMin), smmMax: range(1.1 * sSmm), smmMin: range(0.9 * sSmm),
    boneMax: range(leanMax * 0.067), boneMin: range(leanMin * 0.067),
    waterMassMax: range(leanMax * 0.733), waterMassMin: range(leanMin * 0.733),
    proteinMassMax: range(leanMax * 0.2), proteinMassMin: range(leanMin * 0.2),
    muscleMassMax: range(leanMax * 0.733 + leanMax * 0.2), muscleMassMin: range(leanMin * 0.733 + leanMin * 0.2),
    bmrMax: trunc(1.1 * sBmr), bmrMin: trunc(0.9 * sBmr), obesityDegree: obesity,
  };

  // input validation: height 100..260, weight 20..260; trunk >= 1 and limbs >= 100 ohm; corrected trunk >= 0
  const z = [...input.impedances];
  if (h < 100 || h > 260 || w < 20 || w > 260) return { ...standards, error: 1 };
  if (z[0] < 1 || z[5] < 1 || [1, 2, 3, 4, 6, 7, 8, 9].some((i) => z[i] < 100)) return { ...standards, error: 2 };
  const t20 = z[0] * 0.826;
  const t100 = z[5] > z[0] ? fma(z[0], 0.826, -3) : z[5] * 0.826;
  if (t20 < 0 || t100 < 0) return { ...standards, error: 3 };
  z[0] = t20;
  z[5] = t100;
  const [, la20, ra20, ll20, rl20, , la100, ra100, ll100, rl100] = z;

  // fat mass and body fat %
  let fm = fatMassRaw(w, h, bmi, z);
  let pbf = (fm / w) * 100;
  if (pbf < 3) [pbf, fm] = [3, w * 0.03];
  else if (pbf > 60) [pbf, fm] = [60, w * 0.6];
  fm = r1(f32(fm), fm);
  pbf = r1(f32(pbf), pbf);
  const ffm = w - fm;

  // body age: age plus an offset from body-fat bands
  const bands = male ? [14, 19, 24, 27, 30, 33, 36] : [24, 28, 32, 35, 38, 42, 45];
  const band = bands.findIndex((limit) => pbf < limit);
  const bodyAge = age + (band >= 0 ? [-3, -2, -1, 1, 2, 3, 4][band] : male || pbf >= 46 ? 5 : 0);

  const sc = Math.max(bodyScore(h, w, male, pbf), 20);

  // segmental fat (kg)
  let laF = fma(la100, 0.007476, fma(fm, 0.081201, la20 * -0.005752)) + -0.662152;
  let raF = fma(ra100, 0.007476, fma(fm, 0.081201, ra20 * -0.005752)) + -0.662152;
  let rlF = fma(rl100, 0.008645, fma(fm, 0.135438, rl20 * -0.00801)) + 0.492479;
  let llF = fma(ll100, 0.008645, fma(fm, 0.135438, ll20 * -0.00801)) + 0.492479;
  let trF = fma(t100, -0.131612, fma(fm, 0.552545, t20 * 0.068621)) + 0.322704;
  if (Math.abs(raF - laF) > 0.3) {
    if (raF > laF) {
      const d = (la20 + la100) / 20213;
      laF = (la20 > ra20 ? -d : d) + raF;
    } else {
      const d = (ra20 + ra100) / 20213;
      raF = (ra20 > la20 ? -d : d) + laF;
    }
  }
  if (Math.abs(rlF - llF) > 0.5) {
    if (rlF > llF) {
      const d = (ll20 + ll100) / 20213;
      llF = (ll20 > rl20 ? -d : d) + rlF;
    } else {
      const d = (rl20 + rl100) / 20213;
      rlF = (rl20 > ll20 ? -d : d) + llF;
    }
  }
  if (raF < 0.1) raF = (ra20 + ra100) / 20213 + 0.1;
  if (laF < 0.1) laF = (la20 + la100) / 20113 + 0.1;
  if (trF < 0.1) trF = (t20 + t100) / 20203 + 0.1;
  if (rlF < 0.1) rlF = (rl20 + rl100) / 20213 + 0.1;
  if (llF < 0.1) llF = (ll20 + ll100) / 20113 + 0.1;

  // segmental muscle (kg)
  let raM = fma(ra100, -0.005857, fma(ffm, 0.058707, ra20 * 0.002847)) + 0.561911;
  let laM = fma(la100, -0.005857, fma(ffm, 0.058707, la20 * 0.002847)) + 0.561911;
  let trM = fma(t100, -0.010469, fma(ffm, 0.440922, t20 * 0.005246)) + -0.275461;
  let rlM = fma(rl100, 0.008157, fma(ffm, 0.176554, rl20 * -0.007381)) + -0.688932;
  let llM = fma(ll100, 0.008157, fma(ffm, 0.176554, ll20 * -0.007381)) + -0.688932;
  if (raM < 0.2) raM = (ra20 + ra100) / 20213 + 0.2;
  if (laM < 0.2) laM = (la20 + la100) / 20113 + 0.2;
  if (trM < 0.7) trM = (t20 + t100) / 20203 + 0.7;
  if (rlM < 0.2) rlM = (rl20 + rl100) / 20213 + 0.2;
  if (llM < 0.2) llM = (ll20 + ll100) / 20113 + 0.2;

  // whole-body composition
  const water = ffm * 0.733;
  const protein = ffm * 0.2;
  const sm = fma(water, 0.834, -2.627);
  const subcut = fma(pbf, -0.0002, 0.72) * pbf;
  const vfal = Math.max(Math.min(trunc(fma(fm, 0.502, ffm * -0.029) + -0.477), 20), 1);
  const bone = ffm * 0.067;

  // controls (to reach standard)
  const fatCtl = r1(f32(sBfm - fm), sBfm - fm);
  let ffmCtl = r1(f32(sFfm - ffm), sFfm - ffm);
  if (ffmCtl < 0) ffmCtl = 0;
  const wCtl = ffmCtl + fatCtl;

  // segment standards (percent of expected)
  const armMStd = fma(w, 0.02, fma(sFfm, 0.102, h * -0.045)) + 3.752;
  const trMStd = fma(w, 0.166, fma(sFfm, 0.485, h * -0.16)) + 13.595;
  const legMStd = fma(w, 0.059, fma(sFfm, 0.168, h * -0.056)) + 4.775;
  const armFStd = fma(sBfm, 0.101, h * -0.004) + 0.331;
  const trFStd = fma(sBfm, 0.389, h * 0.006) + -0.683;
  const legFStd = fma(sBfm, 0.215, h * -0.005) + 0.391;
  const smi = (raM + laM + rlM + llM) / hm2;
  const percent = (v: number) => range((v / w) * 100);

  const segments = {
    leftArmBodyfatMass: laF, rightArmBodyfatMass: raF, trunkBodyfatMass: trF,
    leftLegBodyfatMass: llF, rightLegBodyfatMass: rlF,
    leftArmBodyfatPercentage: (laF / armFStd) * 100, rightArmBodyfatPercentage: (raF / armFStd) * 100,
    trunkBodyfatPercentage: (trF / trFStd) * 100,
    leftLegBodyfatPercentage: (llF / legFStd) * 100, rightLegBodyfatPercentage: (rlF / legFStd) * 100,
    leftArmMuscleMass: laM, rightArmMuscleMass: raM, trunkMuscleMass: trM,
    leftLegMuscleMass: llM, rightLegMuscleMass: rlM,
    leftArmMuscle: (laM / armMStd) * 100, rightArmMuscle: (raM / armMStd) * 100,
    trunkMuscle: (trM / trMStd) * 100, leftLegMuscle: (llM / legMStd) * 100, rightLegMuscle: (rlM / legMStd) * 100,
  };
  return {
    ...standards,
    bfr: r1(pbf), muscle: percent(water + protein), subcutfat: range(subcut), vfal: r1(f32(vfal)),
    bone: range(bone), water: percent(water), protein: percent(protein), sm: percent(sm),
    bmr: trunc(fma(ffm, 21.6, 370)), age: bodyAge, bodyScore: r1(f32(sc)),
    weightTarget: range(w + wCtl), bfmControl: r1(fatCtl), ffmControl: range(ffmCtl), weightControl: wCtl,
    bodyType: bodyType(male, bmi, pbf), smi: range(smi),
    ...segments,
    fatMass: fm, fatFreeMass: ffm, waterMass: water, proteinMass: protein, smMass: sm, error: 0,
    ...girth(w, h, bmi, z),
    armBalance: armBalance(f32(segments.leftArmMuscle), f32(segments.rightArmMuscle)),
    legBalance: legBalance(f32(segments.leftLegMuscle), f32(segments.rightLegMuscle)),
    armAndLegBalance: armLegBalance(
      f32(segments.leftArmMuscle), f32(segments.rightArmMuscle),
      f32(segments.leftLegMuscle), f32(segments.rightLegMuscle),
    ),
  };
}
