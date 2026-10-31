# LUCA VOSS FG2504WB research

Scale protocol, body-composition calculations, and measurement tools. Product decisions live in `docs/scale-integration-spec.md`.

## Device

- Advertises as `MY_SCALE`, manufacturer data `AC 2C …` (iComon), service UUIDs `FFB0` and `1530`.
- Device information: model `FG2504WB-A`, manufacturer `ICOMON`, firmware `1.0.1`, hardware `B1.0.3`, software `B1.0.4`.
- Advertising byte 1 = `0x2C`: bit 7 = 0 (connect mode), `(0x2C >> 4) & 7 = 2` (fat scale), `0x2C & 0xF = 12` (subtype 12 → `ICWeightScaleV3Worker`, protocol `WeightGeneralV2`). Bit 24 of the big-endian word at offset 8 is set: 8 electrodes. The last four bytes are a feature bitmask (`0x4400`: nickname, baby mode), not a weight.
- Byte 9 of the final record contains the calculation identifier (`0x2B` = 43).

## Protocol

GATT `FFB0`: `FFB1` write, `FFB2` notify, `FFB3` indicate (handles 0x1D, 0x1F, 0x22 on this unit). Packet: `idx, 00, len, 00, payload…, checksum`; checksum = sum(payload) & 0x1F, `len` = payload length.

| Type | Payload (after the type byte) |
| --- | --- |
| `A2` live weight | status (01 measuring, 03 stable, 00 off), 00, weight grams 24-bit BE, 00 |
| `A7` final / `A5` stored | time 32-bit BE seconds, `2B` (algorithm), weight grams 24-bit BE, 00, `0A` (impedance count), 10 × 16-bit BE impedances in 0.1 Ω (trunk, LA, RA, LL, RL at 20 kHz, then the same at 100 kHz; zeros when the handle is not held), user id 32-bit BE |
| `AA` device info | settings and capability bits (decoded only partly) |
| `A0` ack | acknowledged app packet index |
| `B0` app ack | replied scale packet index, state (0 = ok) |
| `C0` time + profile | time, `01 A4 01`, height cm, last weight ×100 (BE), sex in bit 7 (1 = male) + age, `13 88 13 88` (target 50.00 kg twice), flags `2F`, user id, `01 01 02 6B 69` |
| `C1` user list | `01 01`, height, weight ×100, sex+age, `13 88 13 88`, `0F`, user id, `01 01 02 6B 69` |

Unknown constant fields in `C0`/`C1` are copied verbatim from FitDays+ and were accepted by the scale.

Device tests (1 Nov 2026, captures in `captures/`):

- Test A, no handshake: impedances arrive when the handle is held; the record still carries the FitDays+ user id; unacknowledged records repeat every 10 s.
- Test B, handshake with user id `0DA5CA1E`: the scale acknowledged `C0`/`C1` (`A0`), flushed its stored `A5` records, and tagged the next `A7` with `0DA5CA1E`.

## Body composition

Calculation details:

- trunk impedances corrected (×0.826, special case when 100 kHz > 20 kHz); input validation (height 100–260, weight 20–260, trunk ≥ 1 Ω, limbs ≥ 100 Ω);
- fat mass from an 18-coefficient float32 regression clamped to 3–60 %;
- water 0.733 FFM, protein 0.2 FFM, bone 0.067 FFM, skeletal muscle 0.834 × water − 2.627, BMR 370 + 21.6 FFM, visceral level trunc(0.502 FM − 0.029 FFM − 0.477) in 1–20, subcutaneous fat, segment fat and muscle with asymmetry and floor corrections, body age, score, body type, balances, standards and ranges;
- WHR from a 40-feature regression, or waist / hip when girth estimation is on;
- girth estimation: six 29-feature regressions for waist, chest, hip, arm, thigh and neck;
- height-indexed standard tables (`tables.json`).

Verification results: 2000/2000 matching cases without girth, 2000/2000 matching cases with girth.

## Tools

Python 3.13+ (for `math.fma`). Install with `python3 -m venv venv && venv/bin/pip install -r tools/requirements.txt`; run scripts from `tools/`.

| Script | Purpose |
| --- | --- |
| `compare_fat.py` | BIA fat % versus RFM from the scale's waist estimate |
| `att_dump.py` | dump ATT traffic from an Android `btsnoop_hci.log` |

`probe/` is the Android GATT probe used for the captures; start it with `adb shell am start -n dev.diascale.blescan/.MainActivity --ez handshake true` to send the handshake.
