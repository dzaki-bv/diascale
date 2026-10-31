"""Collapse the 1-decimal rounding idiom and copy chains in a lifted trace.

Idiom (scalar or per-lane):  frac = fmodf(x, 1); t = frac*10; g = fmodf(t, 1);
  sel = t+1 if g > 0.5 else t; result = trunc(sel)/10 + trunc(y)
becomes  result = r1(x, y)   (y is the value whose integer part is used).
Then inline single-use plain copies and drop dead definitions.
"""
import re
import sys

lines = open(sys.argv[1]).read().splitlines()
defs = {}
for i, l in enumerate(lines):
    m = re.match(r"(t\d+) = (.*)$", l)
    if m:
        defs[m[1]] = (i, m[2])


def d(name):
    return defs.get(name, (None, None))[1]


def strip_cast(e):
    # peel f32(...)/f64(...)/float(int(trunc(...))) wrappers around a single name
    for pat in (r"f32\((t\d+)\)$", r"f64\((t\d+)\)$", r"f32\(as_int32\((t\d+)\)\)$", r"wrap32\((t\d+)\)$"):
        m = re.match(pat, e or "")
        if m:
            return m[1]
    return None


def trunc_src(name, depth=0):
    """If name is (a cast of) trunc(X), return X."""
    e = d(name)
    if e is None or depth > 4:
        return None
    m = re.match(r"(?:float\()?int\(trunc\(([^()]+)\)\)\)?$", e)
    if m:
        return m[1]
    s = strip_cast(e)
    return trunc_src(s, depth + 1) if s else None


out = list(lines)
for name, (i, e) in list(defs.items()):
    m = re.match(r"f32\((t\d+) \+ (t\d+)\)$", e)
    if not m:
        continue
    h, j = m[1], m[2]
    mh = re.match(r"f32\((t\d+) / f32\(10\.0\)\)$", d(h) or "")
    if not mh:
        h, j = j, h
        mh = re.match(r"f32\((t\d+) / f32\(10\.0\)\)$", d(h) or "")
        if not mh:
            continue
    sel = trunc_src(mh[1])
    if not sel or not re.fullmatch(r"t\d+", sel):
        continue
    ms = re.match(r"\((t\d+) if \(?(t\d+)(?: > f32\(0\.5\)\))? else (t\d+)\)$", d(sel) or "")
    if not ms:
        continue
    t = ms[3]
    mt = re.match(r"f32\((t\d+) \* f32\(10\.0\)\)$", d(t) or "")
    if not mt:
        continue
    mf = re.match(r"fmodf\((.+), f32\(1\.0\)\)$", d(mt[1]) or "")
    if not mf:
        continue
    y = trunc_src(j)
    if y is None:
        continue
    x = mf[1]
    out[i] = f"{name} = r1({x}, {y})"

# dead code elimination: keep lines that feed R[...] stores or guards
needed = set()
keep = [False] * len(out)
for i in range(len(out) - 1, -1, -1):
    l = out[i]
    m = re.match(r"(t\d+) = (.*)$", l)
    if m:
        if m[1] in needed:
            keep[i] = True
            needed |= set(re.findall(r"\bt\d+\b", m[2]))
    else:
        keep[i] = not l.startswith("# !! int op")
        needed |= set(re.findall(r"\bt\d+\b", l))
print("\n".join(l for l, k in zip(out, keep) if k))
