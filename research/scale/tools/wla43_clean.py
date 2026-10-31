"""Clean re-implementation of iComon ICBodyFatAlgorithmWLA43::calc (FG2504WB, 8 electrodes).

Inputs: weight kg, height cm (int), sex (1 male, 2 female), age (int),
        imps = 10 raw impedances (ohm) in scale order:
        [trunk20, LA20, RA20, LL20, RL20, trunk100, LA100, RA100, LL100, RL100]
Arithmetic mirrors the binary: float32 where it used float32, fused multiply-add
where it used fmadd, and the same 1-decimal rounding helper. Girth estimation
(enableGirth) is not included.
"""
import json
import math
import os
import struct

import numpy as np


def f32(x):
    return float(np.float32(x))


fma = math.fma


def fmodf(a, b):
    return f32(math.fmod(a, b))


def r1(x, y=None):
    """Round to 1 decimal like the library: fraction digit rounded half-up (> .5), integer part of y."""
    y = x if y is None else y
    t = f32(fmodf(f32(x), 1.0) * f32(10.0))
    sel = f32(t + f32(1.0)) if fmodf(t, 1.0) > 0.5 else t
    return f32(f32(f32(math.trunc(sel)) / f32(10.0)) + f32(math.trunc(y)))


_T = json.load(open(os.path.join(os.path.dirname(__file__), "tables.json")))


# ---------------- ICAlgCommon helpers ----------------
def std_bmi(h, age, sex, people=0):
    if age > 17:
        return 22.0 if sex == 1 else 21.0
    return _T[f"bmi_age17_sex{sex}"][min(max(h, 0), 300)]


def std_smm(h, age, sex):
    return _T[f"smm_age{18 if age > 17 else 17}_sex{sex}"][min(max(h, 0), 300)]


def bmi_upper(people):
    return [25.0, 30.0, 28.0, 27.0][people - 1] if 1 <= people <= 4 else 30.0


def bmi_lower(people):
    return [23.0, 25.0, 24.0, 24.0][people - 1] if 1 <= people <= 4 else 25.0


def _h2(h):
    hm = f32(h / 100.0)
    return f32(hm * hm)


def std_weight(h, age, sex, people):
    return f32(_h2(h) * std_bmi(h, age, sex, people))


def std_bfm(h, age, sex, people):
    return f32((0.15 if sex == 1 else 0.23) * f32(_h2(h) * std_bmi(h, age, sex, people)))


def std_ffm(h, age, sex, people):
    return f32((0.85 if sex == 1 else 0.77) * f32(_h2(h) * std_bmi(h, age, sex, people)))


def std_bmr(h, age, sex, people):
    return math.trunc(f32(fma(std_ffm(h, age, sex, people), 21.6, 370.0)))


def score(h, w, age, sex, pbf, people):
    w = f32(w)
    fm = f32(pbf / 100.0 * w)
    ffm = f32(w - fm)
    sw = f32(_h2(h) * std_bmi(h, age, sex, people))
    sffm = f32((0.85 if sex == 1 else 0.77) * sw)
    sbfm = f32((0.15 if sex == 1 else 0.23) * sw)
    d_ffm = f32(ffm - sffm) + 80.0
    d_fm = f32(fm - sbfm)
    v = fma(d_fm, 0.983, d_ffm) if d_fm < 0 else fma(d_fm, -0.958, d_ffm)
    return math.trunc(v)


def arm_balance(a, b):
    d = abs(f32(a - b))
    return 2 if d >= 10 else (1 if d >= 6 else 0)


def leg_balance(a, b):
    d = abs(f32(a - b))
    return 2 if d >= 5 else (1 if d >= 3 else 0)


def arm_leg_balance(la, ra, ll, rl):
    arm = math.trunc(f32(f32(f32(f32(la + ra) * f32(0.5)) - f32(100.0)) / f32(15.0)))
    leg = math.trunc(f32(f32(f32(f32(ll + rl) * f32(0.5)) - f32(100.0)) / f32(10.0)))
    d = abs(arm - leg)
    return 2 if d >= 2 else (1 if d == 1 else 0)


def body_type(sex, bmi, pbf):
    lo, mid, hi = (10.0, 15.0, 20.0) if sex == 1 else (18.0, 23.0, 28.0)
    if bmi < 18.5 and pbf < lo:
        return 0
    if pbf < hi and bmi < 18.5 and pbf >= lo:
        return 1
    if 18.5 <= bmi < 22 and pbf < lo:
        return 2
    if 18.5 <= bmi < 22 and lo <= pbf < mid:
        return 3
    if 22 <= bmi < 25 and pbf < mid:
        return 4
    if pbf < hi and 18.5 <= bmi < 25 and pbf >= mid:
        return 5
    if bmi >= 25 and pbf < mid:
        return 6
    if pbf < hi and bmi >= 25 and pbf >= mid:
        return 7
    if bmi >= 25 and pbf >= hi:
        return 8
    if 22 <= bmi < 25 and pbf >= hi:
        return 9
    return 10 if (pbf >= hi and bmi < 22) else 0


# ---------------- WLA43 regressions ----------------
_BF = [0x3E90EE3F, 0x3AA2966C, 0xBB25E002, 0x3F62343D, 0x3F970C2C, 0xC195BB17, 0x405BC085, 0xBD2E099F,
       0xBF43BC0B, 0xC1DE8624, 0x4316754D, 0x4441B6A6, 0xC469BB7A, 0xBF0CEE01, 0x3DF3E45D, 0x3FA72E7F,
       0xBFB69DFB, 0xC2AE3535]
BF = [struct.unpack("<f", struct.pack("<I", h))[0] for h in _BF]


def _par(a, b):
    return f32(f32(a * b) / f32(a + b))


def fat_mass_raw(w, h, bmi, z):
    """ICBodyFatAlgorithmWLA43::calcBF; z has trunk values already corrected."""
    t20, a1, a2, l1, l2, t100, a1h, a2h, l1h, l2h = [f32(v) for v in z]
    w, h = f32(w), f32(h)
    h2 = f32(h * h)
    arm20, arm100, leg20, leg100 = f32(a1 + a2), f32(a1h + a2h), f32(l1 + l2), f32(l1h + l2h)
    z20 = f32(f32(_par(a1, a2) + t20) + _par(l1, l2))
    z100 = f32(f32(_par(a1h, a2h) + t100) + _par(l1h, l2h))
    limbs = f32(f32(f32(arm20 + arm100) * f32(0.5)) + f32(f32(leg20 + leg100) * f32(0.5)))
    r = f32(fma(w, BF[0], 0.0))
    r = f32(fma(f32(w * w), BF[1], r))
    r = f32(fma(h2, BF[2], r))
    r = f32(fma(h, BF[3], r))
    r = f32(fma(f32(bmi), BF[4], r))
    for feat, k in ((f32(limbs / h2), 5), (f32(h2 / limbs), 6), (f32(h2 / z20), 7), (f32(h2 / z100), 8),
                    (f32(arm20 / h2), 9), (f32(arm100 / h2), 10), (f32(leg20 / h2), 11), (f32(leg100 / h2), 12),
                    (f32(h2 / arm20), 13), (f32(h2 / arm100), 14), (f32(h2 / leg20), 15), (f32(h2 / leg100), 16)):
        r = f32(fma(feat, BF[k], r))
    return f32(r + BF[17])


_WHR_COEF = [0.004613923840224743, 1.454566609027097e-05, -2.1142072000657208e-05, -0.0007152269245125353,
             -0.006957625970244408, -0.002303469693288207, 0.004452168941497803, 0.014823568053543568,
             0.0022643720731139183, -0.010098490864038467, 0.002619063016027212, -0.0037165714893490076,
             -0.0023263159673660994, 0.011014733463525772, 0.13338060677051544, -0.5725440382957458,
             -2.739877223968506, -0.5594097375869751, 1.8687069416046143, -0.1797514259815216,
             0.5277798771858215, 0.5406519174575806, -2.0791192054748535, 7.878778706071898e-05,
             -3.554136856109835e-05, 0.00017592347285244614, 4.8191061068791896e-05, -0.00012233802408445626,
             -9.596181917004287e-05, 3.8060684346419293e-06, -1.9787330529652536e-05, 0.00017278089944738895,
             1.169865369796753, 0.918518602848053, -0.007019151002168655, 0.20594455301761627,
             -0.10937649011611938, -0.9890053868293762, -0.7043123245239258, -0.3479173183441162]


def whr(w, h, bmi, z):
    """ICAlgCommon::calcWHR(predictWHR). Uses corrected trunk20 (z[0]); trunk100 is not a feature."""
    W, H, B = f32(w), f32(h), f32(bmi)
    t20, la, ra, ll, rl, _, la1, ra1, ll1, rl1 = [f32(v) for v in z]
    seg = [la, ra, t20, ll, rl, la1, ra1, ll1, rl1]
    feats = [W, f32(W * W), f32(H * H), H, B] + seg + [f32(v / H) for v in seg] + \
            [f32(v * B) for v in seg] + [f32(H / v) for v in seg[:8]]
    s = 0.0
    for c, x in zip(_WHR_COEF, feats):
        s = f32(s + f32(f32(c) * x))
    s = f32(fma(f32(H / rl1), f32(0.0001994896010728553), s))
    s = f32(s + f32(1.3684715032577515))
    t = f32(fmodf(s, 1.0) * f32(1000.0))
    sel = f32(t + f32(1.0)) if fmodf(t, 1.0) > 0.5 else t
    frac = f32(f32(math.trunc(sel)) / f32(1000.0))
    ip = f32(math.trunc(s))
    if frac == 0.0 and f32(s - ip) > 0.99:
        frac = 1.0
    v = f32(f32(frac + ip) + -0.015)
    if v > 1.1:
        return f32(1.1)
    if v < 0.7:
        return f32(0.7)
    return v


# Girth estimation (ICAlgCommon::calcWLA39, used when enableGirth is on).
# Seven regressions share 29 features; the 7th (fat mass) only feeds an internal check, so it is omitted.
_GIRTH = {
    'waist': (34.98903649980075, [0.4865601716076885, -0.0015639412975475186, 0.0021184938649201246, -0.5365956329083479, 1.7897243245416214, 4836.365996147566, 5297.1027565448285, -0.013757218825361189, 1.3626710692442956, -1.7561417864353501e-06, -1391.2915698620684, 1194.4926978540395, -10629.616097596114, 3280.3465751667786, -9.736171335816834e-08, -6736.660641294494, -14227.97346732427, 2636.289580594276, -16221.60875606242, -3.7471181713044643e-10, 1.0278970532598102, 0.26048375218823283, -0.24238987782496513, 0.9204647208848709, 0.0, -0.8217866925442789, -0.9814636925320523, 0.006028788176356053, -1.1733451451552064]),
    'chest': (137.20231014654996, [0.1891068467847119, -0.0006306809835491655, 0.004336011687648825, -1.2660569006370888, 1.6659388648903808, 1124.565542266414, 678.0121607206288, -0.17713572431258925, 0.6538966255680618, 2.4948289556459e-07, -4961.068596748919, 5198.69074950448, 2547.2657965204735, -7701.203976530249, 1.3840335100212542e-08, 3470.763053997312, -6810.299992458713, -6693.91927669234, 7368.79828305358, 5.7411853049416095e-11, -0.968023341531717, 0.9588410900602554, 0.25887613836086537, -0.07489756886366884, 0.0, 0.673420345518054, -0.8694481132539746, -0.518501867767555, 0.06473995812209747]),
    'hip': (-56.550479147121806, [0.5068262308476017, -0.0019179478712885753, -0.0016509277231111313, 0.8138206173766124, 1.3231600091904234, -7611.493908046574, 6157.5115976845145, -1.958957946199871, 1.4473221497296835, -3.6468801573041887e-06, 10320.7775401247, 3246.2194167353173, -2951.2576965727453, 19036.430122271377, -2.0402293188226395e-07, -8323.380042044122, -1763.077079527707, 4828.69281754258, -17173.621210181867, -7.645439836778678e-10, 1.402355379716674, -0.6942727394290639, -0.481094977905574, 1.7073536881527482, 0.0, -1.1394800810740813, 0.5855993687351049, 0.4223073643416699, -1.3660526124968226]),
    'arm': (49.7593884386485, [0.19737298711152024, -0.0009590439804605451, 0.001243510403288481, -0.41447832454403244, 0.5040290150324626, -9755.401995752987, 12784.889169467953, -2.8417193577638797, 2.71335307022886, -5.848596700067099e-06, 11310.625332238402, 9226.294469591705, 5165.01902457623, 12404.828696104667, -3.276505786686812e-07, -13206.467880257307, -13755.407256092423, -8711.895535088055, -14783.741980275061, -1.2137206795159727e-09, 1.3412601253098981, 0.2942325762957877, 0.15154726258759987, 0.6728460840356641, 0.0, -0.9918894025468263, -0.5481428437019003, -0.2736896536940503, -0.5773525127012301]),
    'thigh': (26.752015443937356, [0.7926521351622984, -0.0024398957288929214, -0.0012395703130812276, 0.15973636750596035, -0.004349981074185007, -11966.81324861802, 13953.340464174351, -3.3106396802187184, 2.901568394946315, -6.631950944011034e-06, 9143.576261214104, 10734.600495485136, 9795.262826078077, 16316.273467014611, -3.7157990462333146e-07, -12622.325410344713, -11083.518378706867, -10505.018606287233, -19633.765620216167, -1.372654878650792e-09, 0.3876272001940726, 0.7210290968616135, 0.24370301451543808, 1.09499959018832, 0.0, -0.7025918135462157, -0.3927155143294351, -0.06683698935657573, -1.0618967744949896]),
    'neck': (-30.807665888254938, [0.15671400310499484, -0.00019658462740510703, -0.001697531884991903, 0.5664070627784221, 0.05946502259257977, 12205.204448390654, -13725.58591159043, 1.7538070855370227, -1.391365649095396, 6.64470232866754e-06, -14506.763372872538, -9627.955759794795, -11906.410521613865, -12067.903986998981, 3.72560922556886e-07, 16363.473712553296, 10698.239804737037, 12249.503070757088, 14948.786367823415, 1.3765486528427573e-09, -0.9564197344168627, -0.11547215344790404, -0.2273712088504191, -0.4809535776167474, 0.0, 0.9043155882862252, 0.0005500260674002421, 0.05411946507378205, 0.5338143286456998]),
}


def girth(w, h, bmi, z):
    """Estimated circumferences in cm (1 decimal) and WHR = waist / hip (2 decimals). z: corrected impedances."""
    t20, la20, ra20, ll20, rl20, t100, la100, ra100, ll100, rl100 = [f32(v) for v in z]
    H = f32(h)
    W, B = f32(w), f32(bmi)
    HH = H * H

    def fsum(vals):
        s = 0.0
        for v in vals:
            s = f32(s + v)
        return s

    s20 = fsum((ra20, la20, t20, rl20, ll20))
    s100 = fsum((ra100, la100, t100, rl100, ll100))
    den20 = (t20 + _par(ra20, la20)) + _par(rl20, ll20)
    den100 = (t100 + _par(ra100, la100)) + _par(rl100, ll100)
    seg20 = (t20, ra20, la20, rl20, ll20)
    seg100 = (t100, ra100, la100, rl100, ll100)
    feats = [W, W * W, f32(H * H), H, B, s20 / H / H, s100 / H / H, HH / den20, HH / den100] + \
            [v / H / H for v in seg20 + seg100] + [HH / v for v in seg20 + seg100]
    out = {}
    for name, (const, coefs) in _GIRTH.items():
        acc = 0.0
        for c, x in zip(coefs, feats):
            acc = fma(x, c, acc)
        out[name] = f32(acc + const)
    whr = float(r1(f32(f32(out["waist"] / out["hip"]) * f32(10.0)))) / 10.0
    return {k: r1(v) for k, v in out.items()}, whr

# ---------------- main ----------------
def calc(weight, height, sex, age, imps, people=0, enable_girth=False):
    w, h = float(weight), int(height)
    out = {}
    bmi_raw = w * 10000.0 / f32(h * h)
    bmi = r1(f32(bmi_raw), bmi_raw)
    out["bmi"] = bmi
    male = sex == 1

    # standards and ranges (computed before input validation, like the library)
    s_bmr = std_bmr(h, age, sex, people)
    s_w = r1(std_weight(h, age, sex, people))
    s_bfm = r1(std_bfm(h, age, sex, people))
    s_ffm = r1(std_ffm(h, age, sex, people))
    s_bmi = r1(std_bmi(h, age, sex, people))
    s_smm = r1(std_smm(h, age, sex))
    hm2 = h * h / 10000.0
    obesity = math.trunc(r1(f32(w / s_w * 100.0), w / s_w * 100.0))
    w_max, w_min = 1.15 * (hm2 * s_bmi), 0.85 * (hm2 * s_bmi)
    bfm_max, bfm_min = (1.6 if male else 1.395) * s_bfm, (0.8 if male else 0.87) * s_bfm
    lean_max, lean_min = w_max - bfm_max, w_min - bfm_min
    out.update(
        weightStandard=s_w, bfmStandard=s_bfm, bfpStandard=r1(15.0 if male else 23.0), bmiStandard=s_bmi,
        smmStandard=s_smm, ffmStandard=s_ffm, bmrStandard=s_bmr,
        bmiOverweight=r1(bmi_upper(people)), bmiHigh=r1(bmi_lower(people)),
        bfmMax=r1(f32(bfm_max), bfm_max), bfmMin=r1(f32(bfm_min), bfm_min),
        bfpMax=20.0 if male else 28.0, bfpMin=10.0 if male else 18.0,
        weightMax=r1(f32(w_max), w_max), weightMin=r1(f32(w_min), w_min),
        smmMax=r1(f32(1.1 * s_smm), 1.1 * s_smm), smmMin=r1(f32(0.9 * s_smm), 0.9 * s_smm),
        boneMax=r1(f32(lean_max * 0.067), lean_max * 0.067), boneMin=r1(f32(lean_min * 0.067), lean_min * 0.067),
        waterMassMax=r1(f32(lean_max * 0.733), lean_max * 0.733),
        waterMassMin=r1(f32(lean_min * 0.733), lean_min * 0.733),
        proteinMassMax=r1(f32(lean_max * 0.2), lean_max * 0.2), proteinMassMin=r1(f32(lean_min * 0.2), lean_min * 0.2),
        muscleMassMax=r1(f32(lean_max * 0.733 + lean_max * 0.2), lean_max * 0.733 + lean_max * 0.2),
        muscleMassMin=r1(f32(lean_min * 0.733 + lean_min * 0.2), lean_min * 0.733 + lean_min * 0.2),
        bmrMax=math.trunc(1.1 * s_bmr), bmrMin=math.trunc(0.9 * s_bmr), obesityDegree=obesity,
    )

    # input validation: height 100..260, weight 20..260 (library returns no body metrics, error code
    # stays 0); impedances: trunk >= 1, limbs >= 100 (library error code 2); negative trunk -> 3
    z = [float(v) for v in imps]
    if not (100 <= h <= 260) or w < 20 or w > 260:
        return dict(out, error=1)
    if z[0] < 1 or z[5] < 1 or any(z[i] < 100 for i in (1, 2, 3, 4, 6, 7, 8, 9)):
        return dict(out, error=2)
    t20 = z[0] * 0.826
    t100 = fma(z[0], 0.826, -3.0) if z[5] > z[0] else z[5] * 0.826
    if t20 < 0 or t100 < 0:
        return dict(out, error=3)
    z[0], z[5] = t20, t100
    la20, ra20, ll20, rl20 = z[1], z[2], z[3], z[4]
    la100, ra100, ll100, rl100 = z[6], z[7], z[8], z[9]

    # fat mass and body fat %
    fm = float(fat_mass_raw(w, h, bmi, z))
    pbf = fm / w * 100.0
    if pbf < 3.0:
        pbf, fm = 3.0, w * 0.03
    elif pbf > 60.0:
        pbf, fm = 60.0, w * 0.6
    fm = r1(f32(fm), fm)
    pbf = r1(f32(pbf), pbf)
    ffm = w - fm

    # body age: age plus an offset from body-fat bands (age >= 10)
    body_age = age
    if age >= 10:
        bands = (14, 19, 24, 27, 30, 33, 36) if male else (24, 28, 32, 35, 38, 42, 45)
        offs = (-3, -2, -1, 1, 2, 3, 4)
        off = None
        for lim, o in zip(bands, offs):
            if pbf < lim:
                off = o
                break
        if off is None:
            off = 5 if (male or pbf >= 46) else 0
        body_age = age + off

    sc = max(score(h, w, age, sex, pbf, people), 20)

    # segmental fat (kg)
    la_f = fma(la100, 0.007476, fma(fm, 0.081201, la20 * -0.005752)) + -0.662152
    ra_f = fma(ra100, 0.007476, fma(fm, 0.081201, ra20 * -0.005752)) + -0.662152
    rl_f = fma(rl100, 0.008645, fma(fm, 0.135438, rl20 * -0.00801)) + 0.492479
    ll_f = fma(ll100, 0.008645, fma(fm, 0.135438, ll20 * -0.00801)) + 0.492479
    tr_f = fma(t100, -0.131612, fma(fm, 0.552545, t20 * 0.068621)) + 0.322704
    if abs(ra_f - la_f) > 0.3:
        if ra_f > la_f:
            d = (la20 + la100) / 20213.0
            la_f = (-d if la20 > ra20 else d) + ra_f
        else:
            d = (ra20 + ra100) / 20213.0
            ra_f = (-d if ra20 > la20 else d) + la_f
    if abs(rl_f - ll_f) > 0.5:
        if rl_f > ll_f:
            d = (ll20 + ll100) / 20213.0
            ll_f = (-d if ll20 > rl20 else d) + rl_f
        else:
            d = (rl20 + rl100) / 20213.0
            rl_f = (-d if rl20 > ll20 else d) + ll_f
    if ra_f < 0.1:
        ra_f = (ra20 + ra100) / 20213.0 + 0.1
    if la_f < 0.1:
        la_f = (la20 + la100) / 20113.0 + 0.1
    if tr_f < 0.1:
        tr_f = (t20 + t100) / 20203.0 + 0.1
    if rl_f < 0.1:
        rl_f = (rl20 + rl100) / 20213.0 + 0.1
    if ll_f < 0.1:
        ll_f = (ll20 + ll100) / 20113.0 + 0.1

    # segmental muscle (kg)
    ra_m = fma(ra100, -0.005857, fma(ffm, 0.058707, ra20 * 0.002847)) + 0.561911
    la_m = fma(la100, -0.005857, fma(ffm, 0.058707, la20 * 0.002847)) + 0.561911
    tr_m = fma(t100, -0.010469, fma(ffm, 0.440922, t20 * 0.005246)) + -0.275461
    rl_m = fma(rl100, 0.008157, fma(ffm, 0.176554, rl20 * -0.007381)) + -0.688932
    ll_m = fma(ll100, 0.008157, fma(ffm, 0.176554, ll20 * -0.007381)) + -0.688932
    if ra_m < 0.2:
        ra_m = (ra20 + ra100) / 20213.0 + 0.2
    if la_m < 0.2:
        la_m = (la20 + la100) / 20113.0 + 0.2
    if tr_m < 0.7:
        tr_m = (t20 + t100) / 20203.0 + 0.7
    if rl_m < 0.2:
        rl_m = (rl20 + rl100) / 20213.0 + 0.2
    if ll_m < 0.2:
        ll_m = (ll20 + ll100) / 20113.0 + 0.2

    # whole-body composition
    water = ffm * 0.733
    protein = ffm * 0.2
    sm = fma(water, 0.834, -2.627)
    pbf_d = float(pbf)
    subcut = fma(pbf_d, -0.0002, 0.72) * pbf_d
    vfal_i = math.trunc(fma(fm, 0.502, ffm * -0.029) + -0.477)
    vfal = max(min(vfal_i, 20), 1)
    bone = ffm * 0.067

    # controls (to reach standard)
    fat_ctl = r1(f32(s_bfm - fm), s_bfm - fm)
    ffm_ctl = r1(f32(s_ffm - ffm), s_ffm - ffm)
    ffm_ctl = 0.0 if ffm_ctl < 0 else ffm_ctl
    w_ctl = ffm_ctl + fat_ctl

    # segment standards (percent of expected)
    hf = float(h)
    arm_m_std = fma(w, 0.02, fma(s_ffm, 0.102, hf * -0.045)) + 3.752
    tr_m_std = fma(w, 0.166, fma(s_ffm, 0.485, hf * -0.16)) + 13.595
    leg_m_std = fma(w, 0.059, fma(s_ffm, 0.168, hf * -0.056)) + 4.775
    arm_f_std = fma(s_bfm, 0.101, hf * -0.004) + 0.331
    tr_f_std = fma(s_bfm, 0.389, hf * 0.006) + -0.683
    leg_f_std = fma(s_bfm, 0.215, hf * -0.005) + 0.391
    smi = (ra_m + la_m + rl_m + ll_m) / hm2

    out.update(
        bfr=r1(pbf), muscle=r1(f32((water + protein) / w * 100.0), (water + protein) / w * 100.0),
        subcutfat=r1(f32(subcut), subcut), vfal=r1(f32(vfal)), bone=r1(f32(bone), bone),
        water=r1(f32(water / w * 100.0), water / w * 100.0), protein=r1(f32(protein / w * 100.0), protein / w * 100.0),
        sm=r1(f32(sm / w * 100.0), sm / w * 100.0), bmr=math.trunc(fma(ffm, 21.6, 370.0)), age=body_age,
        bodyScore=r1(f32(sc)), weightTarget=r1(f32(w + w_ctl), w + w_ctl), bfmControl=r1(fat_ctl),
        ffmControl=r1(f32(ffm_ctl), ffm_ctl), weightControl=w_ctl,
        bodyType=body_type(sex, bmi, pbf_d), smi=r1(f32(smi), smi), whr=whr(w, h, bmi, z),
        leftArmBodyfatMass=la_f, rightArmBodyfatMass=ra_f, trunkBodyfatMass=tr_f,
        leftLegBodyfatMass=ll_f, rightLegBodyfatMass=rl_f,
        leftArmBodyfatPercentage=la_f / arm_f_std * 100, rightArmBodyfatPercentage=ra_f / arm_f_std * 100,
        trunkBodyfatPercentage=tr_f / tr_f_std * 100,
        leftLegBodyfatPercentage=ll_f / leg_f_std * 100, rightLegBodyfatPercentage=rl_f / leg_f_std * 100,
        leftArmMuscleMass=la_m, rightArmMuscleMass=ra_m, trunkMuscleMass=tr_m,
        leftLegMuscleMass=ll_m, rightLegMuscleMass=rl_m,
        leftArmMuscle=la_m / arm_m_std * 100, rightArmMuscle=ra_m / arm_m_std * 100,
        trunkMuscle=tr_m / tr_m_std * 100, leftLegMuscle=ll_m / leg_m_std * 100,
        rightLegMuscle=rl_m / leg_m_std * 100,
        fatMass=fm, fatFreeMass=ffm, waterMass=water, proteinMass=protein, smMass=sm, error=0,
    )
    if enable_girth:
        g, out["whr"] = girth(w, h, bmi, z)
        out.update(g)
    if out["bfr"] > 0:
        la_p, ra_p = out["leftArmMuscle"], out["rightArmMuscle"]
        ll_p, rl_p = out["leftLegMuscle"], out["rightLegMuscle"]
        out["armBalance"] = arm_balance(f32(la_p), f32(ra_p))
        out["legBalance"] = leg_balance(f32(ll_p), f32(rl_p))
        out["armAndLegBalance"] = arm_leg_balance(f32(la_p), f32(ra_p), f32(ll_p), f32(rl_p))
    return out


if __name__ == "__main__":
    raw = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
    for k, v in calc(45.70, 147, 1, 19, raw).items():
        print(f"{k:28s} {v}")
