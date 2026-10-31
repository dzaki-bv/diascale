"""Lift a helper with given int/float/double register args (params struct at DATA)."""
import struct, sys
from unicorn.arm64_const import *
import emu, lift

so, sym, out = sys.argv[1], sys.argv[2], sys.argv[3]
args = sys.argv[4:]  # like i:147 f:21.1 d:45.7 p
lib = emu.Lib(so)
raw = [22.0542, 415.8, 402.5, 359.6, 367.8, 18.9154, 358.3, 345.3, 304.8, 316.2]
pb = emu.params(45.70, 147, 1, 19, raw)
lib.uc.mem_write(emu.DATA, pb)
xi = vi = 0
names = []
for a in args:
    k, _, v = a.partition(":")
    if k == "p":
        lib.uc.reg_write(UC_ARM64_REG_X0 + xi, emu.DATA); xi += 1
    elif k == "i":
        lib.uc.reg_write(UC_ARM64_REG_X0 + xi, int(v) & 0xFFFFFFFF); xi += 1
    elif k == "f":
        lib.uc.reg_write(UC_ARM64_REG_S0 + vi, struct.unpack("<I", struct.pack("<f", float(v)))[0]); vi += 1
    else:
        lib.uc.reg_write(UC_ARM64_REG_D0 + vi, struct.unpack("<Q", struct.pack("<d", float(v)))[0]); vi += 1
L = lift.Lifter(lib, emu.DATA, len(pb), emu.DATA + 0x80000, 0x10)
L.pending = None
L.skip_until = None
xi = vi = 0
for a in args:  # name the arguments
    k = a[0]
    if k in "ip":
        L.reg[("x", xi)] = f"A{xi}"; xi += 1
    elif k in "fd":
        L.reg[("v", vi, 32 if k == "f" else 64, 0)] = f"F{vi}"; vi += 1
from unicorn import UC_HOOK_CODE
def hook(uc, address, size, user):
    if L.pending:
        c, target, at = L.pending
        L.emit(f"guard({c}, {address == target})  # @{at:#x}")
        L.pending = None
    L.hook(uc, address, size, user)
lib.uc.hook_add(UC_HOOK_CODE, hook, begin=emu.BASE, end=emu.BASE + 0x200000)
lib.uc.hook_add(UC_HOOK_CODE, hook, begin=emu.STUBS, end=emu.STUBS + 0x1000)
lib.call(sym, x=())
L.emit(f"RET_S0 = {L.get(('v', 0, 32, 0, 1))}")
L.emit(f"RET_X0 = {L.get(('x', 0, 32, 0, 1))}")
open(out, "w").write("\n".join(L.lines) + "\n")
print(len(L.lines), "lines;", sum("!!" in l for l in L.lines), "unhandled")
