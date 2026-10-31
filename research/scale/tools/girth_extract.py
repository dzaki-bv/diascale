"""Extract the 7 girth regressions (feature order + coefficients) from the lifted trace."""
import re, sys, json
L = open(sys.argv[1]).read().splitlines()
d = {}
for l in L:
    m = re.match(r"(t\d+) = (.*)$", l)
    if m: d[m[1]] = m[2]
base = {"t733": "LA20", "t734": "H", "t735": "RA20", "t736": "T20", "t737": "LL20", "t738": "BMI", "t739": "RL20",
        "t740": "LA100", "t741": "RA100", "t742": "LL100", "t743": "T100", "t744": "RL100", "t567": "W"}
def sym(t):
    if t in base: return base[t]
    e = d.get(t)
    if e is None: return t
    m = re.fullmatch(r"f(?:32|64)\((t\d+)\)", e)
    if m: return sym(m[1])
    m = re.fullmatch(r"f(?:32|64)\((t\d+) ([-+*/]) (t\d+|cvt_bits\(0\.0, 64, 32\))\)", e)
    if m:
        b = "0" if m[3].startswith("cvt") else sym(m[3])
        return f"({sym(m[1])} {m[2]} {b})"
    return f"<{e}>"
outs = {"waist": "t1039", "chest": "t1033", "hip": "t1034", "arm": "t1035", "thigh": "t1036", "neck": "t1037", "fatmass": "t1038"}
res = {}
for name, t in outs.items():
    m = re.fullmatch(r"f64\((t\d+) \+ ([-\d.e]+)\)", d[t])
    acc, const = m[1], float(m[2])
    terms = []
    while True:
        e = d[acc]
        m = re.fullmatch(r"f64\(fma\((\S+), (\S+), (\S+)\)\)", e)
        if not m: raise SystemExit(f"unexpected {acc} = {e}")
        a, b, c = m[1], m[2], m[3]
        if re.fullmatch(r"-?[\d.]+(e-?\d+)?", a): coef, feat = float(a), b
        else: coef, feat = float(b), a
        terms.append((sym(feat), coef))
        if c == "0.0": break
        acc = c
    terms.reverse()
    res[name] = {"terms": terms, "const": const}
feats = [f for f, _ in res["waist"]["terms"]]
for n, v in res.items():
    assert [f for f, _ in v["terms"]] == feats, n
print(len(feats), "features:")
for i, f in enumerate(feats): print(i, f)
json.dump(res, open(sys.argv[2], "w"), indent=1)
