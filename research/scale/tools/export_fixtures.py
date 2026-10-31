"""Export the device-test captures as packet sequences for packages/core tests.

Usage: python3 export_fixtures.py ../captures ../../../packages/core/test/fixtures/captures.json
Each capture becomes a list of {"dir": "in"|"out", "char": "ffb2"|"ffb3"|"ffb1", "hex": ...}.
"""
import json
import os
import re
import sys

src, out = sys.argv[1], sys.argv[2]
captures = {}
for name in ("device-test-a-no-handshake", "device-test-b-handshake"):
    seq = []
    for line in open(os.path.join(src, name + ".log")):
        m = re.search(r"NOTIFY (ffb[23]) ([0-9A-F]+)", line)
        if m:
            seq.append({"dir": "in", "char": m[1], "hex": m[2]})
            continue
        m = re.search(r"WRITE (ffb1) ([0-9A-F]+)", line)
        if m:
            seq.append({"dir": "out", "char": m[1], "hex": m[2]})
    captures[name] = seq
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(captures, open(out, "w"), indent=1)
print({k: len(v) for k, v in captures.items()})
