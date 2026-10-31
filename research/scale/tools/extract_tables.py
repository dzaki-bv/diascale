"""Tabulate the height-indexed standard tables (getStandardBMI for minors, getStandardSMM)."""
import json, struct, sys
import emu, helpers_emu
lib = emu.Lib(sys.argv[1])
env = {}
helpers_emu.bind(lib, env, b"")
H = range(0, 301)
out = {}
for age in (17, 18):
    for sex in (1, 2):
        out[f"bmi_age{age}_sex{sex}"] = [env["getStandardBMI"](h, age, sex, 0) for h in H]
        out[f"smm_age{age}_sex{sex}"] = [env["getStandardSMM"](h, age, sex) for h in H]
# sanity: other ages/people give the same as the 17/18 brackets
for age in (1, 5, 10, 16):
    for sex in (1, 2):
        assert [env["getStandardBMI"](h, age, sex, 1) for h in H] == out[f"bmi_age17_sex{sex}"]
        assert [env["getStandardSMM"](h, age, sex) for h in H] == out[f"smm_age17_sex{sex}"]
for age in (19, 40, 90):
    for sex in (1, 2):
        assert [env["getStandardSMM"](h, age, sex) for h in H] == out[f"smm_age18_sex{sex}"]
json.dump(out, open(sys.argv[2], "w"))
print({k: (v[100], v[147], v[180]) for k, v in out.items()})
d = open(sys.argv[1], "rb").read()
print("armleg divisors", struct.unpack_from("<2f", d, 0x2d310))
