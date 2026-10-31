"""Helper functions backed by the emulator (oracle), for checking lifted calc."""
import struct

from unicorn.arm64_const import *

import emu

SYMS = {
    "getStandardBMILower": ("_ZN11ICAlgCommon19getStandardBMILowerEi", "i", "f"),
    "getStandardBMIUpper": ("_ZN11ICAlgCommon19getStandardBMIUpperEi", "i", "f"),
    "getStandardBMI": ("_ZN11ICAlgCommon14getStandardBMIEiiii", "iiii", "f"),
    "getStandardWeight": ("_ZN11ICAlgCommon17getStandardWeightEiiii", "iiii", "f"),
    "getStandardBFM": ("_ZN11ICAlgCommon14getStandardBFMEiiii", "iiii", "f"),
    "getStandardFFM": ("_ZN11ICAlgCommon14getStandardFFMEiiii", "iiii", "f"),
    "getStandardSMM": ("_ZN11ICAlgCommon14getStandardSMMEiii", "iii", "f"),
    "getScore": ("_ZN11ICAlgCommon8getScoreEifiifi", "ifiifi", "i"),
    "getStandardBMR": ("_ZN11ICAlgCommon14getStandardBMREiiii", "iiii", "i"),
    "calcWHR": ("_ZN11ICAlgCommon7calcWHREP28__ICBodyFatAlgorithmParams__f", "pf", "f"),
    "getArmBalance": ("_ZN11ICAlgCommon13getArmBalanceEff", "ff", "i"),
    "getLegBalance": ("_ZN11ICAlgCommon13getLegBalanceEff", "ff", "i"),
    "getArmAndLegBalance": ("_ZN11ICAlgCommon19getArmAndLegBalanceEffff", "ffff", "i"),
    "WLA43_getBodyType_570": ("_ZN23ICBodyFatAlgorithmWLA4315getBodyType_570Eidd", "idd", "i"),
}


def bind(lib, env, params_bytes):
    def make(sym, kinds, ret):
        def f(*args):
            uc = lib.uc
            xi = vi = 0
            for k, a in zip(kinds, args):
                if k == "i":
                    uc.reg_write(UC_ARM64_REG_X0 + xi, int(a) & 0xFFFFFFFF); xi += 1
                elif k == "p":
                    uc.reg_write(UC_ARM64_REG_X0 + xi, emu.DATA); xi += 1
                elif k == "f":
                    uc.reg_write(UC_ARM64_REG_S0 + vi, struct.unpack("<I", struct.pack("<f", a))[0]); vi += 1
                else:
                    uc.reg_write(UC_ARM64_REG_D0 + vi, struct.unpack("<Q", struct.pack("<d", a))[0]); vi += 1
            lib.call(sym, x=())
            if ret == "i":
                v = uc.reg_read(UC_ARM64_REG_X0) & 0xFFFFFFFF
                return v - (1 << 32) if v >> 31 else v
            return struct.unpack("<f", struct.pack("<I", uc.reg_read(UC_ARM64_REG_S0) & 0xFFFFFFFF))[0]
        return f

    for name, (sym, kinds, ret) in SYMS.items():
        env[name] = make(sym, kinds, ret)
