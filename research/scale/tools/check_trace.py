"""Execute a lifted trace and compare every R[off] store with the emulator."""
import struct
import sys

import emu
import rt

so, trace = sys.argv[1], sys.argv[2]
lib = emu.Lib(so)
raw = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
p = emu.params(45.70, 147, 1, 19, raw)
lib.uc.mem_write(emu.DATA, p)
res = lib.call("_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__", x=(emu.DATA,), result_size=0x300)

R = {}
exec(compile(open(trace).read(), trace, "exec"), rt.make_env(p, R))
bad = 0
for off, v in sorted(R.items()):
    size = 8
    want_d = struct.unpack_from("<d", res, off)[0]
    want_i = struct.unpack_from("<i", res, off)[0]
    ok = (isinstance(v, float) and (v == want_d or abs(v - want_d) < 1e-9)) or (isinstance(v, int) and v == want_i) \
        or (isinstance(v, float) and float(v).is_integer() and int(v) == want_i)
    if not ok:
        bad += 1
        print(f"MISMATCH +{off:#05x}: lifted={v!r} emu_d={want_d!r} emu_i={want_i}")
print(f"{len(R)} stores checked, {bad} mismatches")
