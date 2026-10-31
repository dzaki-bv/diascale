"""Runtime helpers for executing lifted traces (trace.py) in plain Python."""
import math
import struct

import numpy as np


def f32(x):
    return float(np.float32(x))


def f64(x):
    return float(x)


fma = math.fma


def fmodf(a, b):
    return f32(math.fmod(a, b))


def fmod(a, b):
    return math.fmod(a, b)


def trunc(x):
    return math.trunc(x)


floor, ceil, sqrt = math.floor, math.ceil, math.sqrt


def round_away(x):
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


def round_even(x):
    return round(x)


def wrap32(x):
    x = int(x) & 0xFFFFFFFF
    return x - (1 << 32) if x >> 31 else x


def wrap64(x):
    return int(x)


def bits_to_f(v, bits):
    v = int(v)
    if bits == 32:
        return struct.unpack("<f", struct.pack("<I", v & 0xFFFFFFFF))[0]
    return struct.unpack("<d", struct.pack("<Q", v & 0xFFFFFFFFFFFFFFFF))[0]


def bits_64(v):
    return v - (1 << 64) if v >> 63 else v


def bits_32(v):
    return v - (1 << 32) if v >> 31 else v


def f_to_bits(x, bits):
    if bits == 32:
        return struct.unpack("<I", struct.pack("<f", x))[0]
    return struct.unpack("<Q", struct.pack("<d", x))[0]


class Packed:
    """Low lane of a wider register view; only round-trips back to its own width."""
    def __init__(self, low, bits):
        self.low, self.bits = low, bits


def cvt_bits(x, from_bits, to_bits):
    if isinstance(x, Packed) and x.bits == to_bits:
        return x.low
    if from_bits < to_bits:
        return Packed(x, from_bits)
    if x == 0:  # zeroed register (movi #0) viewed at a narrower width
        return 0.0
    raise NotImplementedError(f"lane reinterpret {from_bits}->{to_bits}")


def part(x, off, size):
    raise NotImplementedError("partial stack slot read")


def u32(x):
    return int(x) & 0xFFFFFFFF


def u64(x):
    return int(x) & 0xFFFFFFFFFFFFFFFF


def as_int32(x):
    if isinstance(x, int):
        return x
    if isinstance(x, float) and x.is_integer() and abs(x) > 1e-30 and abs(x) < 2**31:
        return int(x)  # already an integer value held in an FP lane
    return struct.unpack("<i", struct.pack("<f", x))[0]


def as_int64(x):
    if isinstance(x, int):
        return x
    if isinstance(x, float) and x.is_integer() and abs(x) > 1e-300 and abs(x) < 2**63:
        return int(x)
    return struct.unpack("<q", struct.pack("<d", x))[0]


class Guard(Exception):
    pass


def guard(cond, taken):
    if bool(cond) != taken:
        raise Guard("path differs")


def make_env(params, result):
    def PD(o):
        return struct.unpack_from("<d", params, o)[0]

    def PS(o):
        return struct.unpack_from("<f", params, o)[0]

    def PI4(o):
        return struct.unpack_from("<i", params, o)[0]

    def PI8(o):
        return struct.unpack_from("<q", params, o)[0]

    env = {k: v for k, v in globals().items() if not k.startswith("_")}
    env.update(PD=PD, PS=PS, PI4=PI4, PI8=PI8, R=result, TLS=0, SP=0)
    return env


def r1(x, y):
    """1-decimal rounding used throughout: fraction rounded half-up (strictly > .5), float32."""
    t = f32(fmodf(f32(x), f32(1.0)) * f32(10.0))
    sel = f32(t + f32(1.0)) if fmodf(t, f32(1.0)) > f32(0.5) else t
    return f32(f32(f32(trunc(sel)) / f32(10.0)) + f32(trunc(y)))
