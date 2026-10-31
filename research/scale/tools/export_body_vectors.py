"""Export golden vectors of wla43_clean.calc (girth on, adults) for packages/core body tests.

Usage: python3 export_body_vectors.py ../../../packages/core/test/fixtures/body.json [count] [seed]
Inputs follow verify_clean.py's generator with ages 18-90; the real 20:46 measurement comes first.
Also writes the adult standard SMM tables and girth coefficients to packages/core/src/tables.json.
"""
import json
import os
import random
import sys

import wla43_clean as W

out_path = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 500
rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 11)
base = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]

cases = [
    (45.70, 147, 1, 19, base),
    (45.70, 147, 1, 19, [24.8, 427.3, 407.5, 366.0, 371.0, 20.8, 368.0, 348.4, 311.4, 318.3]),  # device test B
    (70.0, 170, 2, 30, base[:3] + [99.9] + base[4:]),  # limb below 100 ohm -> error 2
    (70.0, 170, 1, 30, [2.0] + base[1:5] + [3.0] + base[6:]),  # corrected trunk100 negative -> error 3
]
while len(cases) < n:
    sex = rng.choice([1, 2])
    age = rng.randint(18, 90)
    h = rng.randint(95, 265)
    w = round(rng.choice([rng.uniform(15, 270), rng.uniform(40, 120)]), 2)
    s = rng.uniform(0.5, 1.8)
    imps = [round(v * s * rng.uniform(0.8, 1.2), 1) for v in base]
    if rng.random() < 0.1:
        imps[5] = round(imps[0] * rng.uniform(1.0, 1.3), 1)  # trunk100 > trunk20 branch
    cases.append((w, h, sex, age, imps))

vectors = [{"input": {"weightKg": w, "heightCm": h, "male": sex == 1, "age": age, "impedances": imps},
            "output": W.calc(w, h, sex, age, imps, enable_girth=True)} for w, h, sex, age, imps in cases]
json.dump(vectors, open(out_path, "w"), indent=0)

tables_path = os.path.join(os.path.dirname(out_path), "../../src/tables.json")
json.dump({"smmMale": W._T["smm_age18_sex1"], "smmFemale": W._T["smm_age18_sex2"],
           "girth": {name: {"constant": c, "coefficients": k} for name, (c, k) in W._GIRTH.items()}},
          open(tables_path, "w"))
print(len(vectors), "vectors;", sum(v["output"]["error"] == 0 for v in vectors), "with body metrics")
