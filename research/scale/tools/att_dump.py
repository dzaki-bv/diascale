"""Dump ATT traffic from an Android btsnoop_hci.log (H4 datalink 1002).

Usage: python3 -I att_dump.py btsnoop_hci.log
Prints connection events, characteristic declarations (handle -> UUID) and
every ATT write/notify/indication/read with timestamp and direction.
"""
import struct
import sys
from datetime import datetime, timedelta

EPOCH = datetime(2000, 1, 1) - timedelta(days=730497 - 730120)  # btsnoop epoch = 0 AD; fixed below

ATT_NAMES = {
    0x02: "MTU_REQ", 0x03: "MTU_RSP", 0x08: "RD_TYPE_REQ", 0x09: "RD_TYPE_RSP",
    0x0A: "READ_REQ", 0x0B: "READ_RSP", 0x10: "RD_GRP_REQ", 0x11: "RD_GRP_RSP",
    0x12: "WRITE_REQ", 0x13: "WRITE_RSP", 0x52: "WRITE_CMD", 0x1B: "NOTIFY",
    0x1D: "INDICATE", 0x1E: "CONFIRM", 0x04: "FIND_INFO_REQ", 0x05: "FIND_INFO_RSP",
    0x01: "ERROR",
}


def ts(us):
    # btsnoop timestamps are microseconds since 0000-01-01; offset to Unix epoch.
    unix_us = us - 0x00DCDDB30F2F8000
    return datetime.fromtimestamp(unix_us / 1e6).strftime("%H:%M:%S.%f")[:-3]


def uuid_str(b):
    if len(b) == 2:
        return "%04X" % struct.unpack("<H", b)[0]
    return b[::-1].hex()


def main(path):
    data = open(path, "rb").read()
    pos = 16
    partial = {}  # (conn, dir) -> [expected_len, bytes]
    while pos + 24 <= len(data):
        orig, incl, flags, drops, t = struct.unpack(">IIIIq", data[pos:pos + 24])
        pkt = data[pos + 24:pos + 24 + incl]
        pos += 24 + incl
        direction = "<-" if flags & 1 else "->"  # <- from scale/controller, -> from phone
        if not pkt:
            continue
        if pkt[0] == 0x04 and len(pkt) > 3:  # HCI event
            ev = pkt[1]
            if ev == 0x3E and pkt[3] in (0x01, 0x0A):  # LE (enhanced) connection complete
                status, handle = pkt[4], struct.unpack("<H", pkt[5:7])[0]
                addr = ":".join("%02X" % x for x in pkt[9:15][::-1])
                print(f"{ts(t)} CONNECT handle=0x{handle:03X} peer={addr} status={status}")
            elif ev == 0x05:
                print(f"{ts(t)} DISCONNECT handle=0x{struct.unpack('<H', pkt[4:6])[0]:03X} reason=0x{pkt[6]:02X}")
            continue
        if pkt[0] != 0x02 or len(pkt) < 5:
            continue
        hdr, alen = struct.unpack("<HH", pkt[1:5])
        conn, pb = hdr & 0x0FFF, (hdr >> 12) & 0x3
        payload = pkt[5:5 + alen]
        key = (conn, direction)
        if pb == 0x01:  # continuation fragment
            if key not in partial:
                continue
            partial[key][1] += payload
        else:
            l2len = struct.unpack("<H", payload[0:2])[0]
            partial[key] = [l2len, bytearray(payload)]
        need, buf = partial[key]
        if len(buf) < need + 4:
            continue
        del partial[key]
        cid = struct.unpack("<H", buf[2:4])[0]
        if cid != 0x0004:
            continue
        att = bytes(buf[4:4 + need])
        op = att[0]
        name = ATT_NAMES.get(op, "OP_%02X" % op)
        if op == 0x09:  # read by type rsp: characteristic declarations
            ln = att[1]
            for i in range(2, len(att), ln):
                e = att[i:i + ln]
                if ln in (7, 21):
                    h, props, vh = struct.unpack("<HBH", e[:5])
                    print(f"{ts(t)} {direction} CHAR decl=0x{h:04X} value=0x{vh:04X} props=0x{props:02X} uuid={uuid_str(e[5:])}")
            continue
        if op == 0x05:  # find info rsp: descriptors
            fmt = att[1]
            step = 4 if fmt == 1 else 18
            for i in range(2, len(att), step):
                h = struct.unpack("<H", att[i:i + 2])[0]
                print(f"{ts(t)} {direction} DESC 0x{h:04X} uuid={uuid_str(att[i + 2:i + step])}")
            continue
        if op in (0x12, 0x52, 0x1B, 0x1D, 0x0A, 0x01):
            h = struct.unpack("<H", att[1:3])[0]
            print(f"{ts(t)} {direction} {name:9s} h=0x{h:04X} {att[3:].hex().upper()}")
        elif op == 0x0B:
            print(f"{ts(t)} {direction} {name:9s} {att[1:].hex().upper()}")
        elif op in (0x02, 0x03):
            print(f"{ts(t)} {direction} {name:9s} mtu={struct.unpack('<H', att[1:3])[0]}")


if __name__ == "__main__":
    main(sys.argv[1])
