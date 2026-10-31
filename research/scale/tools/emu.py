"""Run functions from libICBodyFatAlgorithms.so (Android arm64 ELF) under unicorn.

Loads PT_LOAD segments, applies RELATIVE/GLOB_DAT/JUMP_SLOT relocations, and
stubs libc imports (fmodf, fmod, pow, __stack_chk_fail, ...) with Python hooks.
Used only as a local oracle to check our own transcription of WLA43.
"""
import math
import struct
import sys

from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.arm64_const import *

BASE = 0x10000000
STUBS = 0x20000000
STACK = 0x30000000
TLS = 0x31000000
DATA = 0x32000000
RET_MAGIC = 0x33000000

f32 = lambda b: struct.unpack("<f", struct.pack("<I", b & 0xFFFFFFFF))[0]
pf32 = lambda v: struct.unpack("<I", struct.pack("<f", v))[0]
f64 = lambda b: struct.unpack("<d", struct.pack("<Q", b))[0]
pf64 = lambda v: struct.unpack("<Q", struct.pack("<d", v))[0]


class Lib:
    def __init__(self, path):
        self.f = open(path, "rb")
        self.elf = ELFFile(self.f)
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        top = max(s["p_vaddr"] + s["p_memsz"] for s in self.elf.iter_segments() if s["p_type"] == "PT_LOAD")
        self.uc.mem_map(BASE, (top + 0xFFFF) & ~0xFFFF)
        for s in self.elf.iter_segments():
            if s["p_type"] == "PT_LOAD":
                self.uc.mem_write(BASE + s["p_vaddr"], s.data())
        for addr in (STUBS, STACK, TLS, DATA, RET_MAGIC):
            self.uc.mem_map(addr, 0x100000)
        self.uc.reg_write(UC_ARM64_REG_TPIDR_EL0, TLS)
        self.uc.reg_write(UC_ARM64_REG_CPACR_EL1, 0x300000)  # enable FP/SIMD
        self.syms = {}
        dynsym = self.elf.get_section_by_name(".dynsym")
        for sym in dynsym.iter_symbols():
            if sym["st_value"]:
                self.syms[sym.name] = BASE + sym["st_value"]
        self.stub_impl = {}
        self.stub_addr = {}
        self._reloc(dynsym)
        self.uc.hook_add(UC_HOOK_CODE, self._on_stub, begin=STUBS, end=STUBS + 0x100000)
        self.reads = None

    def _stub(self, name):
        if name not in self.stub_addr:
            a = STUBS + 4 * len(self.stub_addr)
            self.uc.mem_write(a, b"\xc0\x03\x5f\xd6")  # ret
            self.stub_addr[name] = a
        return self.stub_addr[name]

    def _reloc(self, dynsym):
        for sec in self.elf.iter_sections():
            if not isinstance(sec, RelocationSection):
                continue
            for r in sec.iter_relocations():
                t, off = r["r_info_type"], r["r_offset"]
                if t == 1027:  # R_AARCH64_RELATIVE
                    val = BASE + r["r_addend"]
                elif t in (1025, 1026, 257):  # GLOB_DAT, JUMP_SLOT, ABS64
                    sym = dynsym.get_symbol(r["r_info_sym"])
                    val = self.syms.get(sym.name) or self._stub(sym.name)
                    val += r["r_addend"] if t == 257 else 0
                else:
                    continue
                self.uc.mem_write(BASE + off, struct.pack("<Q", val))

    def _on_stub(self, uc, addr, size, _):
        name = next(n for n, a in self.stub_addr.items() if a == addr)
        rd = lambda r: uc.reg_read(r)
        s0, s1 = f32(rd(UC_ARM64_REG_S0)), f32(rd(UC_ARM64_REG_S1))
        d0, d1 = f64(rd(UC_ARM64_REG_D0)), f64(rd(UC_ARM64_REG_D1))
        if name == "fmodf":
            uc.reg_write(UC_ARM64_REG_S0, pf32(math.fmod(s0, s1)))
        elif name == "fmod":
            uc.reg_write(UC_ARM64_REG_D0, pf64(math.fmod(d0, d1)))
        elif name == "pow":
            uc.reg_write(UC_ARM64_REG_D0, pf64(math.pow(d0, d1)))
        elif name == "powf":
            uc.reg_write(UC_ARM64_REG_S0, pf32(math.pow(s0, s1)))
        elif name in ("floor", "ceil", "round", "log", "sqrt", "exp"):
            uc.reg_write(UC_ARM64_REG_D0, pf64(getattr(math, name if name != "round" else "floor")(d0 + (0.5 if name == "round" else 0))))
        elif name in ("floorf", "ceilf", "roundf", "logf", "sqrtf", "expf"):
            base = name[:-1]
            v = math.floor(s0 + 0.5) if base == "round" else getattr(math, base)(s0)
            uc.reg_write(UC_ARM64_REG_S0, pf32(v))
        elif name == "__stack_chk_fail":
            raise RuntimeError("stack check failed")
        else:
            raise RuntimeError("unhandled import " + name)

    def call(self, name, x=(), result_size=0, watch=None):
        uc = self.uc
        uc.mem_write(STACK, b"\0" * 0x100000)
        uc.reg_write(UC_ARM64_REG_SP, STACK + 0xF0000)
        uc.reg_write(UC_ARM64_REG_LR, RET_MAGIC)
        for i, v in enumerate(x):
            uc.reg_write(UC_ARM64_REG_X0 + i, v)
        if result_size:
            uc.reg_write(UC_ARM64_REG_X8, DATA + 0x80000)
            uc.mem_write(DATA + 0x80000, b"\0" * result_size)
        self.reads = set()
        h = None
        if watch:
            h = uc.hook_add(UC_HOOK_MEM_READ, lambda u, a, ad, s, v, d: self.reads.add(ad - watch[0]),
                            begin=watch[0], end=watch[0] + watch[1])
        uc.emu_start(self.syms[name], RET_MAGIC, count=5_000_000)
        if h:
            uc.hook_del(h)
        return bytes(uc.mem_read(DATA + 0x80000, result_size)) if result_size else None


def params(weight, height, sex, age, imps, people=0, extra=None):
    buf = bytearray(0x200)
    struct.pack_into("<d", buf, 0, weight)
    struct.pack_into("<iii", buf, 8, height, sex, age)
    for i, v in enumerate(imps):
        struct.pack_into("<d", buf, 0x50 + 8 * i, v)
    struct.pack_into("<i", buf, 0x114, people)
    for off, fmt, v in (extra or []):
        struct.pack_into(fmt, buf, off, v)
    return bytes(buf)


if __name__ == "__main__":
    so = sys.argv[1]
    lib = Lib(so)
    raw = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
    p = params(45.70, 147, 1, 19, raw)
    lib.uc.mem_write(DATA, p)
    res = lib.call("_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__",
                   x=(DATA,), result_size=0x300, watch=(DATA, 0x200))
    print("param offsets read:", sorted(hex(o) for o in lib.reads))
    for off in range(0, 0x300, 8):
        d = struct.unpack_from("<d", res, off)[0]
        i0, i1 = struct.unpack_from("<ii", res, off)
        if d != 0 or i0 or i1:
            print(f"+0x{off:03x}  double={d:<14.6g} ints=({i0}, {i1})")
