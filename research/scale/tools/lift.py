"""Trace-based lifter: run a lib function in the emulator and emit the executed
path as straight-line Python (SSA), so the formulas can be read and re-run.

Each register lane / memory slot remembers the SSA name of its last writer.
Constants loaded from the library become literals; params become P[off];
stores into the result buffer become R[off] = ...; branches become guard().
"""
import re
import struct
import sys

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from unicorn import UC_HOOK_CODE
from unicorn.arm64_const import *

import emu

LANES = {"b": 8, "h": 16, "s": 32, "d": 64, "q": 128}
COND_INV = {"eq": "ne", "ne": "eq", "gt": "le", "le": "gt", "ge": "lt", "lt": "ge",
            "mi": "pl", "pl": "mi", "hi": "ls", "ls": "hi", "hs": "lo", "lo": "hs", "vs": "vc", "vc": "vs"}


def split_ops(s):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


class Lifter:
    def __init__(self, lib, param_base, param_size, res_base, res_size):
        self.lib, self.uc = lib, lib.uc
        self.cs = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
        self.pb, self.ps, self.rb, self.rs = param_base, param_size, res_base, res_size
        self.n = 0
        self.lines = []
        self.reg = {}  # ('v', n, bits, idx) or ('x', n) -> expr
        self.mem = {}  # (addr, size) -> expr
        self.flags = None  # (kind, a, b)
        self.raw = {}  # vreg -> bytes when the register holds a library constant
        self.stub_names = {a: n for n, a in lib.stub_addr.items()}

    # ---------- helpers ----------
    def new(self, expr, f="f64"):
        self.n += 1
        name = f"t{self.n}"
        self.lines.append(f"{name} = {expr}")
        return name

    def emit(self, s):
        self.lines.append(s)

    def parse_reg(self, tok):
        """Return (kind, num, bits, idx, nlanes) for a register token."""
        tok = tok.strip()
        m = re.fullmatch(r"v(\d+)\.(\d+)?([bhsdq])(?:\[(\d+)\])?", tok)
        if m:
            bits = LANES[m[3]]
            if m[4] is not None:
                return ("v", int(m[1]), bits, int(m[4]), 1)
            return ("v", int(m[1]), bits, 0, int(m[2]) if m[2] else 1)
        m = re.fullmatch(r"([bhsdq])(\d+)", tok)
        if m:
            return ("v", int(m[2]), LANES[m[1]], 0, 1)
        m = re.fullmatch(r"([wx])(\d+|zr)", tok)
        if m:
            return ("x", 31 if m[2] == "zr" else int(m[2]), 32 if m[1] == "w" else 64, 0, 1)
        if tok == "sp" or tok == "wsp":
            return ("sp", 0, 64, 0, 1)
        return None

    def get(self, r, lane=0):
        kind, num, bits, idx, _ = r
        if kind == "x":
            if num == 31:
                return "0"
            v = self.reg.get(("x", num))
            if v is None:
                val = self.uc.reg_read(UC_ARM64_REG_X0 + num) if num <= 28 else self.uc.reg_read(
                    {29: UC_ARM64_REG_X29, 30: UC_ARM64_REG_X30}[num])
                return str(val if bits == 64 else val & 0xFFFFFFFF)
            return v
        key = ("v", num, bits, idx + lane)
        if key in self.reg:
            return self.reg[key]
        if num in self.raw:
            b = self.raw[num]
            o = (idx + lane) * bits // 8
            if o + bits // 8 <= len(b):
                chunk = b[o:o + bits // 8]
                if bits == 32:
                    return f"f32({struct.unpack('<f', chunk)[0]!r})"
                if bits == 64:
                    return repr(struct.unpack("<d", chunk)[0])
        # try reading a value written with another lane size at the same bit offset
        off = (idx + lane) * bits
        for key, e in list(self.reg.items()):
            if key[0] != "v":
                continue
            k, n, b, i = key
            if n == num and i * b == off and b != bits:
                return f"cvt_bits({e}, {b}, {bits})"
        return "0.0"

    def put(self, r, expr, lane=0, scalar=False):
        kind, num, bits, idx, _ = r
        if kind == "v":
            self.raw.pop(num, None)
        if kind == "x":
            if num != 31:
                self.reg[("x", num)] = expr
            return
        if scalar:
            for k in [k for k in self.reg if k[0] == "v" and k[1] == num]:
                del self.reg[k]
        else:
            lo, hi = (idx + lane) * bits, (idx + lane + 1) * bits
            for k in [k for k in self.reg if k[0] == "v" and k[1] == num]:
                if k[3] * k[2] < hi and (k[3] + 1) * k[2] > lo:
                    del self.reg[k]
        self.reg[("v", num, bits, idx + lane)] = expr

    def fty(self, bits):
        return "f32" if bits == 32 else "f64"

    def mem_addr(self, tok, insn_size_wb=None):
        m = re.fullmatch(r"\[(\w+)(?:, (#?-?0x[0-9a-f]+|#?-?\d+))?\](!)?", tok)
        base = m[1]
        r = self.parse_reg(base)
        val = self.uc.reg_read(UC_ARM64_REG_SP) if r[0] == "sp" else (
            self.uc.reg_read(UC_ARM64_REG_X0 + r[1]) if r[1] <= 28 else self.uc.reg_read(UC_ARM64_REG_X29))
        disp = int(m[2].lstrip("#"), 0) if m[2] else 0
        return val, disp, bool(m[3])

    def load_val(self, addr, size, fp_bits):
        if (addr, size) in self.mem:
            return self.mem[(addr, size)]
        if self.pb <= addr < self.pb + self.ps:
            kind = {64: "PD", 32: "PS"}.get(fp_bits, "PI%d" % size)
            return f"{kind}({hex(addr - self.pb)})"
        if (addr, size) in self.mem:
            return self.mem[(addr, size)]
        if emu.BASE <= addr < emu.STUBS:  # library constant
            raw = bytes(self.uc.mem_read(addr, size))
            if fp_bits == 64:
                return repr(struct.unpack("<d", raw)[0])
            if fp_bits == 32:
                return f"f32({struct.unpack('<f', raw)[0]!r})"
            return str(int.from_bytes(raw, "little"))
        # stack slot written with a different size: split/merge
        for (a, s), e in self.mem.items():
            if a <= addr < a + s and addr + size <= a + s and s != size:
                return f"part({e}, {addr - a}, {size})"
        return "0"

    # ---------- main hook ----------
    def hook(self, uc, address, size, _):
        if address in self.stub_names:
            name = self.stub_names[address]
            if name == "fmodf":
                a, b = self.get(("v", 0, 32, 0, 1)), self.get(("v", 1, 32, 0, 1))
                self.put(("v", 0, 32, 0, 1), self.new(f"fmodf({a}, {b})"), scalar=True)
            elif name in ("fmod", "pow"):
                a, b = self.get(("v", 0, 64, 0, 1)), self.get(("v", 1, 64, 0, 1))
                self.put(("v", 0, 64, 0, 1), self.new(f"{name}({a}, {b})"), scalar=True)
            else:
                self.emit(f"# call {name}")
            return
        code = bytes(uc.mem_read(address, 4))
        insn = next(self.cs.disasm(code, address))
        try:
            self.step(insn)
        except Exception as e:  # keep going; mark unknowns loudly
            self.emit(f"# !! {insn.mnemonic} {insn.op_str}: {e}")

    def step(self, insn):
        mn, ops = insn.mnemonic, split_ops(insn.op_str)
        addr = insn.address - emu.BASE
        R = [self.parse_reg(o) for o in ops]
        # ---- no-ops / control ----
        if mn in ("ret", "br", "blr", "bl", "b", "nop", "paciasp", "autiasp", "bti", "mrs", "adr"):
            if mn == "mrs":
                self.put(R[0], "TLS")
            if mn == "adr":
                self.put(R[0], str(int(ops[1].lstrip("#"), 0)))
            return
        if mn.startswith("b.") or mn in ("cbz", "cbnz", "tbz", "tbnz"):
            self.branch(insn, mn, ops, addr)
            return
        if mn == "adrp":
            self.put(R[0], str(int(ops[1].lstrip("#"), 0) + emu.BASE))
            return
        # ---- memory ----
        if mn in ("ldr", "ldur", "str", "stur", "ldp", "stp", "ldrsw", "ldrb", "strb", "ldrh", "strh") and "[" in insn.op_str:
            self.memop(mn, ops, R, insn)
            return
        if mn == "ldr" and ops[1].startswith("#"):
            return
        # ---- moves / immediates ----
        if mn in ("mov", "movz", "movn") and R[0] and R[0][0] == "x" and ops[1].startswith("#"):
            v = int(ops[1].lstrip("#"), 0)
            if mn == "movn":
                v = ~v
            self.put(R[0], str(v & (0xFFFFFFFF if R[0][2] == 32 else 0xFFFFFFFFFFFFFFFF)))
            return
        if mn == "movk":
            m = re.match(r"#?(0x[0-9a-f]+|\d+)(?:, lsl #?(\d+))?", ", ".join(ops[1:]))
            cur = self.get(R[0])
            sh = int(m[2]) if m[2] else 0
            if cur.isdigit():
                v = (int(cur) & ~(0xFFFF << sh)) | (int(m[1], 0) << sh)
                self.put(R[0], str(v))
            else:
                self.put(R[0], self.new(f"movk({cur}, {int(m[1], 0)}, {sh})"))
            return
        if mn == "fmov":
            self.fmov(ops, R)
            return
        if mn == "movi":
            r = R[0]
            m = re.match(r"#?(0x[0-9a-f]+|\d+)(?:, lsl #?(\d+))?", ", ".join(ops[1:]))
            imm = int(m[1], 0) << (int(m[2]) if m[2] else 0)
            for i in range(r[4]):
                self.put(r, "0.0" if imm == 0 else f"bits_{r[2]}({imm})", lane=i, scalar=(i == 0 and r[4] == 1))
            if r[2] == 32 and imm == 0x3F000000:
                for i in range(r[4]):
                    self.put(r, "f32(0.5)", lane=i)
            return
        if mn in ("mov", "orr") and R[0] and R[0][0] in ("x", "sp") and len(ops) == 2:
            self.put(R[0], self.get(R[1]) if R[1][0] != "sp" else "SP")
            return
        if mn in ("mov", "ins", "dup") and R[0] and R[0][0] == "v":
            self.vmov(mn, ops, R)
            return
        # ---- FP arithmetic ----
        if mn in ("fadd", "fsub", "fmul", "fdiv", "fabd", "fmax", "fmin", "fmaxnm", "fminnm"):
            sym = {"fadd": "+", "fsub": "-", "fmul": "*", "fdiv": "/"}.get(mn)
            r = R[0]
            n = r[4]
            scalar = n == 1 and not re.search(r"\.\d", ops[0])
            A = [self.get(R[1], 0 if R[1][4] == 1 and "[" in ops[1] else i) for i in range(n)]
            B = [self.get(R[2], 0 if "[" in ops[2] else i) for i in range(n)]
            for i in range(n):
                a, b = A[i], B[i]
                t = self.fty(r[2])
                if sym:
                    e = f"{t}({a} {sym} {b})"
                elif mn == "fabd":
                    e = f"{t}(abs({a} - {b}))"
                else:
                    e = f"{t}({'max' if 'max' in mn else 'min'}({a}, {b}))"
                self.put(r, self.new(e), lane=i, scalar=scalar)
            return
        if mn in ("fmadd", "fmsub", "fnmadd", "fnmsub"):
            a, b, c = self.get(R[1]), self.get(R[2]), self.get(R[3])
            t = self.fty(R[0][2])
            e = {"fmadd": f"{t}(fma({a}, {b}, {c}))", "fmsub": f"{t}(fma(-{a}, {b}, {c}))",
                 "fnmadd": f"{t}(-fma({a}, {b}, {c}))", "fnmsub": f"{t}(fma({a}, {b}, -{c}))"}[mn]
            self.put(R[0], self.new(e), scalar=True)
            return
        if mn in ("fmla", "fmls"):
            r = R[0]
            for i in range(r[4]):
                a = self.get(R[1], i)
                b = self.get(R[2], 0 if "[" in ops[2] else i)
                c = self.get(r, i)
                sgn = "" if mn == "fmla" else "-"
                self.put(r, self.new(f"{self.fty(r[2])}(fma({sgn}{a}, {b}, {c}))"), lane=i)
            return
        if mn in ("fneg", "fabs", "fsqrt", "frintm", "frintp", "frinta", "frintz", "frintn", "frintx"):
            f = {"fneg": "-({})", "fabs": "abs({})", "fsqrt": "sqrt({})", "frintm": "floor({})",
                 "frintp": "ceil({})", "frinta": "round_away({})", "frintz": "trunc({})",
                 "frintn": "round_even({})", "frintx": "round_even({})"}[mn]
            r = R[0]
            for i in range(r[4]):
                self.put(r, self.new(f"{self.fty(r[2])}({f.format(self.get(R[1], i))})"), lane=i,
                         scalar=(r[4] == 1 and not re.search(r"\.\d", ops[0])))
            return
        if mn == "fcvt":
            self.put(R[0], self.new(f"{self.fty(R[0][2])}({self.get(R[1])})"), scalar=True)
            return
        if mn in ("fcvtn", "fcvtl", "fcvtl2", "fcvtn2", "xtn", "xtn2", "ushll", "sshll", "ushll2", "sshll2"):
            r, s = R[0], R[1]
            hi = mn.endswith("2")
            n = r[4] if not hi else s[4]
            srcs = [self.get(s, i + (s[4] // 2 if mn in ("fcvtl2", "ushll2", "sshll2") else 0)) for i in range(n)]
            for i in range(n):
                src = srcs[i]
                if mn.startswith("fcvt"):
                    e = f"{self.fty(r[2])}({src})"
                elif mn.startswith("xtn"):
                    e = f"wrap{r[2]}({src})"
                else:
                    e = src if len(ops) < 3 or ops[2].lstrip('#') == "0" else f"({src} << {int(ops[2].lstrip('#'), 0)})"
                lane = i + (r[4] // 2 if mn in ("fcvtn2", "xtn2") else 0)
                self.put(r, self.new(e), lane=lane)
            return
        if mn in ("scvtf", "ucvtf"):
            r = R[0]
            for i in range(r[4]):
                src = self.get(R[1], i)
                if R[1][0] == "v" and not src.startswith("float(int(") and not src.lstrip("-").isdigit():
                    name = src if re.fullmatch(r"t\d+", src) else None
                    src = f"as_int{R[1][2]}({src})"
                self.put(r, self.new(f"{self.fty(r[2])}({src})"), lane=i,
                         scalar=(r[4] == 1 and not re.search(r"\.\d", ops[0])))
            return
        if mn in ("fcvtzs", "fcvtzu", "fcvtms", "fcvtps", "fcvtas", "fcvtns"):
            r = R[0]
            f = {"fcvtzs": "trunc", "fcvtzu": "trunc", "fcvtms": "floor", "fcvtps": "ceil",
                 "fcvtas": "round_away", "fcvtns": "round_even"}[mn]
            for i in range(r[4]):
                e = f"int({f}({self.get(R[1], i)}))"
                if r[0] == "v":
                    e = f"float({e})"  # keep int value in a vector lane
                self.put(r, self.new(e), lane=i, scalar=(r[0] == "v" and r[4] == 1 and not re.search(r"\.\d", ops[0])))
            return
        if mn in ("fcmp", "fcmpe"):
            self.flags = ("f", self.get(R[0]), "0.0" if ops[1].startswith("#") else self.get(R[1]))
            return
        if mn in ("fccmp", "fccmpe", "ccmp", "ccmn"):
            prev = self.cond_expr(ops[3])
            a = self.get(R[0])
            b = ops[1].lstrip("#") if ops[1].startswith("#") else self.get(R[1])
            self.flags = ("cc", prev, a, b, int(ops[2].lstrip("#"), 0), mn.startswith("f"))
            return
        if mn in ("fcsel", "csel", "csinc", "csinv", "csneg", "cset", "csetm", "cinc", "cneg"):
            self.csel(mn, ops, R)
            return
        if mn in ("fcmgt", "fcmge", "fcmeq", "fcmlt", "fcmle", "cmlt", "cmgt", "cmge", "cmeq", "cmle"):
            r = R[0]
            op = {"gt": ">", "ge": ">=", "eq": "==", "lt": "<", "le": "<="}[mn[-2:]]
            for i in range(r[4]):
                a = self.get(R[1], i)
                b = "0" if len(ops) < 3 or ops[2].startswith("#") else self.get(R[2], i)
                if mn == "cmlt" and "<< 63" in a:
                    e = f"bool({a.split('<<')[0].strip('( ')})"
                else:
                    e = f"({a} {op} {b})"
                self.put(r, self.new(e), lane=i)
            return
        if mn in ("bsl", "bit", "bif"):
            r = R[0]
            if r[2] == 8:  # byte arrangement: use the lane size the operands actually hold
                mask_reg = r[1] if mn == "bsl" else R[2][1]
                lb = 64 if any(k[0] == "v" and k[1] == mask_reg and k[2] == 64 for k in self.reg) else 32
                total = r[4] * 8
                r = ("v", r[1], lb, 0, total // lb)
                R = [r, ("v", R[1][1], lb, 0, total // lb), ("v", R[2][1], lb, 0, total // lb)]
            for i in range(r[4]):
                d, n_, m_ = self.get(r, i), self.get(R[1], i), self.get(R[2], i)
                if mn == "bsl":
                    e = f"({n_} if {d} else {m_})"
                elif mn == "bit":
                    e = f"({n_} if {m_} else {d})"
                else:
                    e = f"({d} if {m_} else {n_})"
                self.put(r, self.new(e), lane=i)
            return
        if mn == "shl" and R[0][0] == "v":
            r = R[0]
            for i in range(r[4]):
                self.put(r, f"({self.get(R[1], i)} << {int(ops[2].lstrip('#'), 0)})", lane=i)
            return
        if mn == "ld1":
            m = re.match(r"\{v(\d+)\.([bhsd])\}\[(\d+)\], \[(x\d+)\]", insn.op_str)
            bits = LANES[m[2]]
            a = self.uc.reg_read(UC_ARM64_REG_X0 + int(m[4][1:]))
            self.put(("v", int(m[1]), bits, 0, 1), self.load_val(a, bits // 8, bits), lane=int(m[3]))
            return
        if mn in ("zip1", "zip2", "uzp1", "uzp2", "trn1", "trn2"):
            r = R[0]
            n = r[4]
            a = [self.get(R[1], i) for i in range(n)]
            b = [self.get(R[2], i) for i in range(n)]
            h = n // 2
            if mn == "zip1":
                out = [x for i in range(h) for x in (a[i], b[i])]
            elif mn == "zip2":
                out = [x for i in range(h, n) for x in (a[i], b[i])]
            elif mn == "uzp1":
                out = a[0::2] + b[0::2]
            elif mn == "uzp2":
                out = a[1::2] + b[1::2]
            elif mn == "trn1":
                out = [x for i in range(0, n, 2) for x in (a[i], b[i])]
            else:
                out = [x for i in range(1, n, 2) for x in (a[i], b[i])]
            for i, e in enumerate(out):
                self.put(r, e, lane=i)
            return
        if mn == "ext":
            imm = int(ops[3].lstrip("#"), 0)
            num = R[1][1]
            bits = 32 if any(k[0] == "v" and k[1] == num and k[2] == 32 for k in self.reg) else 64
            k = bits // 8
            n = 16 // k
            cat = [self.get(("v", R[1][1], bits, 0, 1), i) for i in range(n)] + \
                  [self.get(("v", R[2][1], bits, 0, 1), i) for i in range(n)]
            out = cat[imm // k: imm // k + n]
            for i, e in enumerate(out):
                self.put(("v", R[0][1], bits, 0, 1), e, lane=i)
            return
        if mn in ("add", "sub", "mul") and R[0] and R[0][0] == "v":
            r = R[0]
            sym = {"add": "+", "sub": "-", "mul": "*"}[mn]
            for i in range(r[4]):
                self.put(r, self.new(f"({self.get(R[1], i)} {sym} {self.get(R[2], i)})"), lane=i)
            return
        # ---- integer ----
        if mn in ("add", "sub", "mul", "sdiv", "udiv", "and", "orr", "eor", "lsl", "lsr", "asr", "madd", "msub", "neg", "sxtw", "uxtw", "smull", "umull"):
            self.intop(mn, ops, R)
            return
        if mn in ("cmp", "cmn", "tst"):
            a = self.get(R[0])
            b = ops[1].lstrip("#") if ops[1].startswith("#") or ops[1].startswith("0x") or ops[1].lstrip('-').isdigit() else self.get(R[1])
            self.flags = ("i", a, b if mn == "cmp" else f"-({b})", R[0][2])
            return
        self.emit(f"# !! unhandled {mn} {insn.op_str} @ {addr:#x}")

    # ---------- pieces ----------
    def memop(self, mn, ops, R, insn):
        m = re.fullmatch(r"\[(x\d+), ([wx]\d+)(?:, (uxtw|sxtw|lsl) #?(\d+))?\]", ops[1]) if len(ops) == 2 else None
        if m:
            base = self.uc.reg_read(UC_ARM64_REG_X0 + int(m[1][1:]))
            idx = self.get(self.parse_reg(m[2]))
            sh = int(m[4]) if m[4] else 0
            r = R[0]
            size = r[2] // 8
            if emu.BASE <= base < emu.STUBS and mn.startswith("ld"):
                vals = [self.load_val(base + (i << sh), size, r[2] if r[0] == "v" else 0) for i in range(16)]
                self.put(r, self.new(f"[{', '.join(vals)}][{idx}]"), scalar=True)
                return
            self.emit(f"# !! indexed mem {insn.op_str}")
            return
        pair = mn in ("ldp", "stp")
        memtok = ops[2] if pair else ops[1]
        base, disp, pre = self.mem_addr(memtok)
        post = 0
        rest = ops[3:] if pair else ops[2:]
        if rest:
            post = int(rest[0].lstrip("#"), 0)
        addr = base + disp if not rest else base
        regs = R[:2] if pair else R[:1]
        for k, r in enumerate(regs):
            if r[0] == "v":
                size = r[2] // 8
            else:
                size = {"ldrb": 1, "strb": 1, "ldrh": 2, "strh": 2, "ldrsw": 4}.get(mn, r[2] // 8)
            a = addr + k * size
            if mn.startswith("ld"):
                if r[0] == "v" and size >= 8 and (a, size) not in self.mem and self.has_pieces(a, size):
                    bits, lanes = self.pieces(a, size)
                    for i, e in enumerate(lanes):
                        self.put(("v", r[1], bits, 0, 1), e, lane=i, scalar=(i == 0))
                    continue
                if size == 16:
                    lo, hi = self.load_val(a, 8, 64), self.load_val(a + 8, 8, 64)
                    self.put(("v", r[1], 64, 0, 1), lo, scalar=True)
                    self.put(("v", r[1], 64, 1, 1), hi)
                    if emu.BASE <= a < emu.STUBS:
                        self.raw[r[1]] = bytes(self.uc.mem_read(a, 16))
                else:
                    val = self.load_val(a, size, r[2] if r[0] == "v" else 0)
                    self.put(r, val if not val.startswith("P") else self.new(val), scalar=True)
                    if r[0] == "v" and emu.BASE <= a < emu.STUBS:
                        self.raw[r[1]] = bytes(self.uc.mem_read(a, size)) + bytes(16 - size)
            else:
                for k in [k for k in self.mem if k[0] < a + size and k[0] + k[1] > a]:
                    del self.mem[k]
                if r[0] == "v" and size >= 8:
                    has32 = any(("v", r[1], 32, i) in self.reg for i in range(size // 4))
                    bits = 32 if has32 else 64
                    for i in range(size * 8 // bits):
                        e = self.get(("v", r[1], bits, 0, 1), i)
                        self.mem[(a + i * bits // 8, bits // 8)] = e
                        if self.rb <= a < self.rb + self.rs:
                            self.emit(f"R[{hex(a + i * bits // 8 - self.rb)}] = {e}")
                    continue
                e = self.get(r) if not (r[0] == "x" and r[1] == 31) else "0"
                if r[0] == "x" and size == 4 and not e.lstrip("-").isdigit():
                    e = f"wrap32({e})"
                self.mem[(a, size)] = e
                if self.rb <= a < self.rb + self.rs:
                    self.emit(f"R[{hex(a - self.rb)}] = {e}")
        if pre or rest:
            br = self.parse_reg(re.match(r"\[(\w+)", memtok)[1])
            if br[0] == "x":
                self.reg.pop(("x", br[1]), None)

    def has_pieces(self, a, size):
        return any(k[0] >= a and k[0] + k[1] <= a + size and k[1] < size for k in self.mem)

    def pieces(self, a, size):
        bits = 32 if any(k[0] >= a and k[0] + k[1] <= a + size and k[1] == 4 for k in self.mem) else 64
        n = size * 8 // bits
        out = []
        for i in range(n):
            ad = a + i * bits // 8
            out.append(self.mem.get((ad, bits // 8)) or self.load_val(ad, bits // 8, bits))
        return bits, out

    def fmov(self, ops, R):
        r = R[0]
        if ops[1].startswith("#"):
            v = float(ops[1].lstrip("#"))
            lit = f"f32({v!r})" if r[2] == 32 else repr(v)
            for i in range(r[4]):
                self.put(r, lit, lane=i, scalar=(r[4] == 1))
            return
        s = R[1]
        if s[0] == "x":
            v = self.get(s)
            if v.isdigit() or (v.startswith("-") and v[1:].isdigit()):
                iv = int(v)
                lit = repr(struct.unpack("<f", struct.pack("<I", iv & 0xFFFFFFFF))[0]) if r[2] == 32 else \
                      repr(struct.unpack("<d", struct.pack("<Q", iv & 0xFFFFFFFFFFFFFFFF))[0])
                self.put(r, f"f32({lit})" if r[2] == 32 else lit, scalar=True)
            else:
                self.put(r, f"bits_to_f({v}, {r[2]})", scalar=True)
            return
        if r[0] == "x":
            self.put(r, f"f_to_bits({self.get(s)}, {s[2]})")
            return
        self.put(r, self.get(s), scalar=True)

    def vmov(self, mn, ops, R):
        r, s = R[0], R[1]
        if mn == "dup":
            src = self.get(s)
            if s[0] == "x" and src.lstrip("-").isdigit() and r[2] in (32, 64):
                iv = int(src)
                src = repr(struct.unpack("<d", struct.pack("<Q", iv & 0xFFFFFFFFFFFFFFFF))[0]) if r[2] == 64 else \
                      f"f32({struct.unpack('<f', struct.pack('<I', iv & 0xFFFFFFFF))[0]!r})"
            for i in range(r[4]):
                self.put(r, src, lane=i)
            return
        if "[" in ops[0]:  # insert into lane
            self.put(r, self.get(s), lane=0)
            return
        if re.fullmatch(r"v\d+\.16b", ops[0]):  # full copy
            for k in [k for k in self.reg if k[0] == "v" and k[1] == s[1]]:
                self.reg[("v", r[1], k[2], k[3])] = self.reg[k]
            for k in [k for k in self.reg if k[0] == "v" and k[1] == r[1] and ("v", s[1], k[2], k[3]) not in self.reg]:
                del self.reg[k]
            return
        self.put(r, self.get(s), scalar=True)  # mov s0, v1.s[1]

    def cond_expr(self, cc):
        if self.flags and self.flags[0] == "cc":
            _, prev, a, b, nzcv, _f = self.flags
            n, z, c_, v = (nzcv >> 3) & 1, (nzcv >> 2) & 1, (nzcv >> 1) & 1, nzcv & 1
            const = {"eq": z, "ne": 1 - z, "ge": int(n == v), "lt": int(n != v), "gt": int(z == 0 and n == v),
                     "le": int(not (z == 0 and n == v)), "mi": n, "pl": 1 - n, "hi": int(c_ and not z),
                     "ls": int(not (c_ and not z)), "hs": c_, "lo": 1 - c_}[cc]
            op = {"eq": "==", "ne": "!=", "gt": ">", "le": "<=", "ge": ">=", "lt": "<", "mi": "<", "pl": ">=",
                  "hi": ">", "ls": "<=", "hs": ">=", "lo": "<"}[cc]
            return f"(({a} {op} {b}) if {prev} else {bool(const)})"
        kind, a, b = self.flags[:3] if self.flags else ("?", "?", "?")
        if kind == "i" and cc in ("hi", "ls", "hs", "lo"):
            bits = self.flags[3]
            a, b = f"u{bits}({a})", f"u{bits}({b})"
        op = {"eq": "==", "ne": "!=", "gt": ">", "le": "<=", "ge": ">=", "lt": "<", "mi": "<", "pl": ">=",
              "hi": ">", "ls": "<=", "hs": ">=", "lo": "<", "vs": "is_nan_or", "vc": "not_nan"}[cc]
        if kind == "f" and cc in ("ge", "hs"):
            op = ">="
        return f"({a} {op} {b})"

    def csel(self, mn, ops, R):
        r = R[0]
        cc = ops[-1]
        c = self.cond_expr(cc)
        if mn in ("cset", "csetm"):
            e = f"(1 if {c} else 0)" if mn == "cset" else f"(-1 if {c} else 0)"
        elif mn in ("cinc", "cneg"):
            a = self.get(R[1])
            e = f"({a} + 1 if {c} else {a})" if mn == "cinc" else f"(-{a} if {c} else {a})"
        else:
            a, b = self.get(R[1]), self.get(R[2])
            alt = {"fcsel": b, "csel": b, "csinc": f"({b} + 1)", "csinv": f"(~{b})", "csneg": f"(-{b})"}[mn]
            e = f"({a} if {c} else {alt})"
        self.put(r, self.new(e), scalar=True)

    def intop(self, mn, ops, R):
        r = R[0]
        if r[0] != "x":
            self.emit(f"# !! int op on {ops}")
            return

        def val(i):
            t = ops[i]
            if t.startswith("#") or re.fullmatch(r"-?(0x[0-9a-f]+|\d+)", t):
                return str(int(t.lstrip("#"), 0))
            rr = self.parse_reg(t.split(",")[0])
            return "SP" if rr[0] == "sp" else self.get(rr)

        if mn in ("neg", "sxtw", "uxtw"):
            e = {"neg": f"-({val(1)})", "sxtw": val(1), "uxtw": val(1)}[mn]
        elif mn in ("madd", "msub"):
            e = f"({val(3)} {'+' if mn == 'madd' else '-'} {val(1)} * {val(2)})"
        else:
            sym = {"add": "+", "sub": "-", "mul": "*", "sdiv": "//", "udiv": "//", "and": "&", "orr": "|",
                   "eor": "^", "lsl": "<<", "lsr": ">>", "asr": ">>", "smull": "*", "umull": "*"}[mn]
            b = val(2)
            if len(ops) > 3:
                m = re.match(r"(lsl|lsr|asr|sxtw|uxtw) ?#?(\d+)?", ops[3])
                if m and m[2]:
                    b = f"({b} {'<<' if m[1] == 'lsl' else '>>'} {m[2]})"
            e = f"({val(1)} {sym} {b})"
        a = val(1)
        if all(re.fullmatch(r"-?\d+", x) for x in re.findall(r"[\w\.]+", e) if not x in ("SP",)) and "SP" not in e:
            try:
                self.put(r, str(eval(e.replace("//", "//"))))
                return
            except Exception:
                pass
        self.put(r, self.new(e) if "SP" not in e else e)

    def branch(self, insn, mn, ops, addr):
        target = int(ops[-1].lstrip("#"), 0)
        pc_after = self.uc.reg_read(UC_ARM64_REG_PC)
        if mn.startswith("b."):
            c = self.cond_expr(mn[2:])
        elif mn in ("cbz", "cbnz"):
            c = f"({self.get(self.parse_reg(ops[0]))} {'==' if mn == 'cbz' else '!='} 0)"
        else:
            bit = int(ops[1].lstrip("#"), 0)
            c = f"((({self.get(self.parse_reg(ops[0]))}) >> {bit}) & 1 {'==' if mn == 'tbz' else '!='} 0)"
        self.pending = (c, target, addr)

    def after(self, uc, address, size, _):
        pass


# PLT stubs of helpers that are abstracted as calls: addr -> (name, arg kinds, return kind)
HELPERS = {
    0x102c70: ("getStandardBMILower", "i", "f"), 0x102c80: ("getStandardBMIUpper", "i", "f"),
    0x102c90: ("getStandardBMI", "iiii", "f"), 0x102ca0: ("getStandardBMI2", "iiii", "f"),
    0x102cb0: ("getStandardWeight", "iiii", "f"), 0x102cc0: ("getStandardBFM", "iiii", "f"),
    0x102cd0: ("getStandardFFM", "iiii", "f"), 0x102ce0: ("getStandardSMM", "iii", "f"),
    0x102cf0: ("getScore", "ifiifi", "i"), 0x102d00: ("getStandardBMR", "iiii", "i"),
    0x102d10: ("getSMI", "iff", "f"), 0x102d20: ("getPhysicalAge", "ifi", "i"),
    0x102d30: ("getBodyType_570", "iff", "i"), 0x102d60: ("calcWHR", "pf", "f"),
    0x102d90: ("getArmBalance", "ff", "i"), 0x102da0: ("getLegBalance", "ff", "i"),
    0x102db0: ("getArmAndLegBalance", "ffff", "i"), 0x104390: ("WLA43_getBodyType_570", "idd", "i"),
}


def run(lib, fn, param_bytes, res_size=0x300, abstract=False):
    lib.uc.mem_write(emu.DATA, param_bytes)
    L = Lifter(lib, emu.DATA, len(param_bytes), emu.DATA + 0x80000, res_size)
    L.pending = None
    lo, hi = emu.BASE, emu.BASE + 0x200000

    L.skip_until = None
    L.calls = []

    def code_hook(uc, address, size, user):
        if L.skip_until is not None:
            if address != L.skip_until:
                return
            L.skip_until = None
            name, args, ret = L.cur_call
            t = L.new(f"{name}({', '.join(args)})")
            for k in [k for k in L.reg if k[0] == "v" and k[1] <= 7] + [("x", i) for i in range(0, 18)]:
                L.reg.pop(k, None)
            if ret == "i":
                L.put(("x", 0, 64, 0, 1), t)
            else:
                L.put(("v", 0, 32 if ret == "f" else 64, 0, 1), t, scalar=True)
        if abstract and (address - emu.BASE) in HELPERS:
            name, kinds, ret = HELPERS[address - emu.BASE]
            args, xi, vi = [], 0, 0
            for k in kinds:
                if k in "ip":
                    args.append(L.get(("x", xi, 32 if k == "i" else 64, 0, 1))); xi += 1
                else:
                    args.append(L.get(("v", vi, 32 if k == "f" else 64, 0, 1))); vi += 1
            L.cur_call = (name, args, ret)
            L.calls.append(name)
            L.skip_until = uc.reg_read(UC_ARM64_REG_LR)
            return
        if L.pending:
            c, target, at = L.pending
            taken = address == target
            L.emit(f"guard({c}, {taken})  # @{at:#x}")
            L.pending = None
        L.hook(uc, address, size, user)

    h1 = lib.uc.hook_add(UC_HOOK_CODE, code_hook, begin=lo, end=hi)
    h2 = lib.uc.hook_add(UC_HOOK_CODE, code_hook, begin=emu.STUBS, end=emu.STUBS + 0x1000)
    res = lib.call(fn, x=(emu.DATA,), result_size=res_size)
    lib.uc.hook_del(h1)
    lib.uc.hook_del(h2)
    return L, res


if __name__ == "__main__":
    lib = emu.Lib(sys.argv[1])
    raw = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
    L, res = run(lib, "_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__",
                 emu.params(45.70, 147, 1, 19, raw), abstract=len(sys.argv) > 3)
    open(sys.argv[2], "w").write("\n".join(L.lines) + "\n")
    print(len(L.lines), "lines;", sum("!!" in l for l in L.lines), "unhandled")
