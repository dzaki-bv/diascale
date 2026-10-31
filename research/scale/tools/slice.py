"""Print the backward slice of the trace that feeds R[off] (last store)."""
import re, sys
lines = open(sys.argv[1]).read().splitlines()
off = sys.argv[2]
idx = max(i for i, l in enumerate(lines) if l.startswith(f"R[{off}] ="))
need = set(re.findall(r"\bt\d+\b", lines[idx].split("=", 1)[1]))
keep = [idx]
for i in range(idx - 1, -1, -1):
    m = re.match(r"(t\d+) = (.*)", lines[i])
    if m and m[1] in need:
        keep.append(i)
        need |= set(re.findall(r"\bt\d+\b", m[2]))
for i in sorted(keep):
    print(lines[i])
