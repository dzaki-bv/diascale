"""Compare wla43_clean.calc against the original calc (emulated) on random inputs."""
import collections
import random
import struct
import sys

import emu
import wla43_clean as W

D = {  # result struct offset -> (name, kind)
    0x0: "bmi", 0x8: "bfr", 0x10: "muscle", 0x18: "subcutfat", 0x20: "vfal", 0x28: "bone", 0x30: "water",
    0x38: "protein", 0x40: "sm", 0x50: "leftLegBodyfatPercentage", 0x58: "leftLegBodyfatMass",
    0x60: "leftLegMuscle", 0x68: "leftLegMuscleMass", 0x70: "rightLegBodyfatPercentage",
    0x78: "rightLegBodyfatMass", 0x80: "rightLegMuscle", 0x88: "rightLegMuscleMass",
    0x90: "leftArmBodyfatPercentage", 0x98: "leftArmBodyfatMass", 0xa0: "leftArmMuscle",
    0xa8: "leftArmMuscleMass", 0xb0: "rightArmBodyfatPercentage", 0xb8: "rightArmBodyfatMass",
    0xc0: "rightArmMuscle", 0xc8: "rightArmMuscleMass", 0xd0: "trunkBodyfatPercentage",
    0xd8: "trunkBodyfatMass", 0xe0: "trunkMuscle", 0xe8: "trunkMuscleMass", 0xf0: "bodyScore",
    0xf8: "weightTarget", 0x100: "bfmControl", 0x108: "ffmControl", 0x110: "weightControl",
    0x120: "weightStandard", 0x128: "bfmStandard", 0x130: "bfpStandard", 0x138: "bmiStandard",
    0x140: "smmStandard", 0x148: "ffmStandard", 0x158: "bmiOverweight", 0x160: "bmiHigh", 0x168: "bfmMax",
    0x170: "bfmMin", 0x178: "bfpMax", 0x180: "bfpMin", 0x188: "weightMax", 0x190: "weightMin",
    0x198: "smmMax", 0x1a0: "smmMin", 0x1a8: "boneMax", 0x1b0: "boneMin", 0x1c0: "waterMassMax",
    0x1c8: "waterMassMin", 0x1d0: "proteinMassMax", 0x1d8: "proteinMassMin", 0x1e0: "muscleMassMax",
    0x1e8: "muscleMassMin", 0x1f0: "smi", 0x200: "whr",
}
GIRTH = "--girth" in sys.argv
if GIRTH:
    D.update({0x218: "waist", 0x220: "chest", 0x228: "hip", 0x230: "arm", 0x238: "thigh", 0x240: "neck"})
    sys.argv.remove("--girth")
I = {0x48: "bmr", 0x4c: "age", 0x118: "bodyType", 0x150: "bmrStandard", 0x1b8: "bmrMax", 0x1bc: "bmrMin",
     0x1f8: "obesityDegree", 0x208: "armBalance", 0x20c: "legBalance", 0x210: "armAndLegBalance"}

lib = emu.Lib(sys.argv[1])
N = int(sys.argv[2]) if len(sys.argv) > 2 else 500
rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
FN = "_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__"
base = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
bad = collections.Counter()
examples = {}
n_ok = 0
for _ in range(N):
    sex = rng.choice([1, 2])
    age = rng.choice([rng.randint(5, 17), rng.randint(18, 90)])
    h = rng.randint(95, 265)
    w = round(rng.choice([rng.uniform(15, 270), rng.uniform(40, 120)]), 2)
    s = rng.uniform(0.5, 1.8)
    imps = [round(v * s * rng.uniform(0.8, 1.2), 1) for v in base]
    if rng.random() < 0.1:
        imps[5] = round(imps[0] * rng.uniform(1.0, 1.3), 1)  # trunk100 > trunk20 branch
    p = emu.params(w, h, sex, age, imps, extra=[(0x1c, "<i", 1)] if GIRTH else None)
    lib.uc.mem_write(emu.DATA, p)
    res = lib.call(FN, x=(emu.DATA,), result_size=0x300)
    err = struct.unpack_from("<i", res, 0x248)[0]
    mine = W.calc(w, h, sex, age, imps, enable_girth=GIRTH)
    if err != (mine["error"] and {1: 0, 2: 2, 3: 3}[mine["error"]]):
        bad["error-code"] += 1
        examples.setdefault("error-code", (w, h, sex, age, imps, err, mine["error"]))
        continue
    ok = True
    for off, name in list(D.items()) + list(I.items()):
        if name not in mine:
            continue
        want = struct.unpack_from("<d", res, off)[0] if off in D else struct.unpack_from("<i", res, off)[0]
        got = mine[name]
        if not (want == got or (off in D and abs(want - got) <= 1e-9 * max(1, abs(want)))):
            bad[name] += 1
            ok = False
            examples.setdefault(name, (w, h, sex, age, imps, want, got))
    n_ok += ok
print(f"{N} samples, {n_ok} fully identical")
for k, v in bad.most_common():
    print(f"  {k}: {v}   e.g. {examples[k]}")
