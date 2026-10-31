"""Annotate a compact r2 listing ("addr insn" per line) with resolved constants.

- adrp xN, PAGE + ldr {d,s,q}M, [xN, off]  -> value(s) at PAGE+off
- mov wN/xN imm + movk ... + fmov {s,d}M, wN/xN -> float/double value
Usage: python annotate.py lib.so listing.s > listing.ann
"""
import re
import struct
import sys

from elftools.elf.elffile import ELFFile

so, listing = sys.argv[1], sys.argv[2]
elf = ELFFile(open(so, "rb"))
segs = [(s["p_vaddr"], s.data()) for s in elf.iter_segments() if s["p_type"] == "PT_LOAD"]


def read(addr, n):
    for va, data in segs:
        if va <= addr < va + len(data):
            return data[addr - va:addr - va + n]
    return None


pages, imm = {}, {}
for line in open(listing):
    addr, _, insn = line.rstrip("\n").partition(" ")
    note = ""
    m = re.match(r"adrp (x\d+), (0x[0-9a-f]+)", insn)
    if m:
        pages[m[1]] = int(m[2], 16)
    m = re.match(r"ldr ([dsq])(\d+), \[(x\d+), (0x[0-9a-f]+)\]", insn)
    if m and m[3] in pages:
        a = pages[m[3]] + int(m[4], 16)
        if m[1] == "d":
            note = "%.10g" % struct.unpack("<d", read(a, 8))[0]
        elif m[1] == "s":
            note = "%.8g" % struct.unpack("<f", read(a, 4))[0]
        else:
            b = read(a, 16)
            note = "q: %.10g, %.10g | f: %s" % (*struct.unpack("<2d", b), ", ".join("%.6g" % v for v in struct.unpack("<4f", b)))
    m = re.match(r"ldp ([dsq])(\d+), ([dsq])(\d+), \[(x\d+), (0x[0-9a-f]+)\]", insn)
    if m and m[5] in pages:
        a = pages[m[5]] + int(m[6], 16)
        if m[1] == "d":
            note = "%.10g, %.10g" % struct.unpack("<2d", read(a, 16))
        elif m[1] == "s":
            note = "%.8g, %.8g" % struct.unpack("<2f", read(a, 8))
    m = re.match(r"mov ([wx]\d+), (0x[0-9a-f]+|-?\d+)$", insn)
    if m:
        imm[m[1][1:]] = int(m[2], 0) & 0xFFFFFFFFFFFFFFFF
    m = re.match(r"movk ([wx]\d+), (0x[0-9a-f]+|\d+), lsl (\d+)", insn)
    if m and m[1][1:] in imm:
        r, sh = m[1][1:], int(m[3])
        imm[r] = (imm[r] & ~(0xFFFF << sh)) | (int(m[2], 0) << sh)
    m = re.match(r"fmov ([sd])(\d+), ([wx])(\d+)$", insn)
    if m and m[4] in imm:
        v = imm[m[4]]
        note = ("%.8g" % struct.unpack("<f", struct.pack("<I", v & 0xFFFFFFFF))[0]) if m[1] == "s" else \
               ("%.10g" % struct.unpack("<d", struct.pack("<Q", v))[0])
    print(f"{addr} {insn}" + (f"    ; {note}" if note else ""))
