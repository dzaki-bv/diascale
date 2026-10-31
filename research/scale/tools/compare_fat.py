"""Compare BIA body-fat % (WLA43) with RFM % from the scale's own waist estimate.

1) The real 20:46 measurement.
2) NHANES-anchored simulation: for adult NHANES rows, scale the measured impedance
   profile until the scale's waist estimate equals the person's real waist, then
   compare WLA43 BIA fat % with RFM (= dataset FATPERSN for that waist).
"""
import csv, os, random, statistics
import wla43_clean as W

def rfm(sex, h, waist):
    return (64 if sex == 1 else 76) - 20 * h / waist

base = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
o = W.calc(45.70, 147, 1, 19, base, enable_girth=True)
print(f"20:46  BIA {o['bfr']:.1f}%  waist {o['waist']:.1f} cm  RFM {rfm(1, 147, o['waist']):.1f}%")

rows = list(csv.reader(open(os.path.join(os.path.dirname(__file__), "../../../dataset/dataset.csv"), encoding="utf-8")))
h = rows[0]; I = h.index
rng = random.Random(3)
adults = [r for r in rows[1:] if r[0].strip() and float(r[I("RIDAGEYR")]) >= 18]
rng.shuffle(adults)
diffs = {1: [], 2: []}; fails = 0
for r in adults[:1500]:
    sex = int(r[I("RIAGENDR")]); age = int(float(r[I("RIDAGEYR")]))
    ht = float(r[I("BMXHT")]); wt = float(r[I("BMXWEIGHT")]); waist = float(r[I("BMXWAIST")])
    hcm = round(ht)
    def est(s):
        z = [round(v * s, 1) for v in base]
        out = W.calc(wt, hcm, sex, age, z, enable_girth=True)
        return out
    lo, hi = 0.45, 3.5
    ok = False
    for _ in range(40):
        mid = (lo + hi) / 2
        out = est(mid)
        if out.get("error") or "waist" not in out:
            break
        if out["waist"] > waist: hi = mid  # estimated waist grows with impedance
        else: lo = mid
        ok = True
    out = est((lo + hi) / 2)
    if not ok or out.get("error") or abs(out["waist"] - waist) > 1.0:
        fails += 1
        continue
    diffs[sex].append(out["bfr"] - rfm(sex, ht, waist))
print(f"simulated adults matched: {sum(map(len, diffs.values()))}, unmatched {fails}")
for sex, d in diffs.items():
    if not d: continue
    q = statistics.quantiles(d, n=20)
    print(f"{'men  ' if sex == 1 else 'women'} n={len(d)}  mean BIA-RFM {statistics.mean(d):+.1f} pts  "
          f"median {statistics.median(d):+.1f}  90% range [{q[0]:+.1f}, {q[-1]:+.1f}]  "
          f"|diff|>5 pts: {sum(abs(x) > 5 for x in d) / len(d):.0%}")
