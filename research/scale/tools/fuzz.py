"""Random inputs: run emulator, and the lifted trace when its path guards hold.

Reports how often the 20:46 path applies and which guards fail first, and
whether outputs agree whenever the path matches.
"""
import collections
import random
import re
import struct
import sys

import emu
import rt
import helpers_emu

so, trace = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 300
lib = emu.Lib(so)
code = compile(open(trace).read(), trace, "exec")
FN = "_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__"
fails = collections.Counter()
ok = same = 0
rng = random.Random(1)


def sample():
    sex = rng.choice([1, 2])
    age = rng.randint(18, 80)
    h = rng.randint(140, 195)
    w = round(rng.uniform(40, 120), 2)
    scale = rng.uniform(0.7, 1.4)
    base = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
    imps = [round(v * scale * rng.uniform(0.93, 1.07), 1) for v in base]
    return w, h, sex, age, imps


for _ in range(N):
    w, h, sex, age, imps = sample()
    p = emu.params(w, h, sex, age, imps)
    lib.uc.mem_write(emu.DATA, p)
    res = lib.call(FN, x=(emu.DATA,), result_size=0x300)
    R = {}
    env = rt.make_env(p, R)
    helpers_emu.bind(lib, env, p)
    try:
        exec(code, env)
    except rt.Guard as e:
        import traceback
        tb = traceback.extract_tb(e.__traceback__)
        line = [f for f in tb if f.filename == trace][-1].lineno
        fails[line] += 1
        continue
    ok += 1
    bad = [o for o, v in R.items() if o not in (0x10c,) and not (
        (isinstance(v, float) and abs(v - struct.unpack_from("<d", res, o)[0]) < 1e-9) or
        (isinstance(v, (int, float)) and float(v).is_integer() and int(v) == struct.unpack_from("<i", res, o)[0]))]
    same += not bad
    if bad and ok <= 2:
        print('sample', w, h, sex, age, [(hex(o), R[o], struct.unpack_from('<d', res, o)[0], struct.unpack_from('<i', res, o)[0]) for o in bad[:6]])
print(f"{N} samples: path matched {ok}, outputs identical {same}")
src = open(trace).read().splitlines()
for line, n in fails.most_common(15):
    print(f"{n:4d}  line {line}: {src[line - 1][:110]}")
