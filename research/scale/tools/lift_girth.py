import sys, emu, lift
lib = emu.Lib(sys.argv[1])
raw = [26.7, 415.8, 402.5, 359.6, 367.8, 22.9, 358.3, 345.3, 304.8, 316.2]
p = emu.params(45.70, 147, 1, 19, raw, extra=[(0x1c, "<i", 1)])
L, res = lift.run(lib, "_ZN23ICBodyFatAlgorithmWLA434calcE28__ICBodyFatAlgorithmParams__", p, abstract=True)
open(sys.argv[2], "w").write("\n".join(L.lines) + "\n")
import struct
print([round(struct.unpack_from("<d", res, o)[0], 3) for o in range(0x218, 0x248, 8)], struct.unpack_from("<d", res, 0x200)[0])
