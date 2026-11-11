# Scale integration spec

Source of truth: the design interview of 31 Oct – 1 Nov 2026 and the device tests run on the TECNO CM7 with the LUCA VOSS FG2504WB. DiaScale is a non-commercial prototype.

## Scope

DiaScale reads the LUCA VOSS FG2504WB over Bluetooth, computes four required numbers on the phone, scores diabetes type 2 risk with the paper's formula, stores results locally, and archives them on a Cloudflare server.

- Supported device: FG2504WB only (iComon, 8 electrodes, broadcast `AC 2C`, subtype 12). Any other scale is rejected as unsupported.
- Users: 18 years and older. Signup below 18 is refused.
- FitDays+ is not used alongside DiaScale.

## Required numbers

| Number      | Definition                                                          |
| ----------- | ------------------------------------------------------------------- |
| BMI         | weight / height²                                                    |
| Fat mass    | weight × BIA body fat % / 100                                       |
| Visceral    | paper formula −182.65 + 3.35 × waist, waist from the girth estimate |
| Muscle mass | dataset formula 0.46 × (weight − fat mass)                          |

## Risk score (`score: diascale@2`)

Rules follow the formulas in `dataset/NHANES_DATARASIO_READY.xlsx` (exported as `dataset/dataset.csv`). Inputs are the displayed, rounded values.

| Component                            | Points                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Visceral                             | < 100 → 0, < 120 → 10, < 140 → 20, < 160 → 30, else 40                              |
| BMI                                  | ≥ 25 → 18, ≥ 23 → 9, else 0                                                         |
| Body fat % (BIA)                     | men < 20 → 0, < 25 → 4, < 30 → 8, < 35 → 13, else 18; women < 30, < 35, < 40, < 45 |
| Muscle (SMI = muscle mass / height²) | men < 7 → 14, < 8.5 → 7, else 0; women < 5.7 → 14, < 6.5 → 7, else 0                |
| Antihypertensive medication          | Yes → 5                                                                             |
| Family diabetes history              | Yes → 5                                                                             |

Category: Aman < 40, Meningkat 40–74, Waspada ≥ 75. Family history is scored as of `diascale@2` (BMI, body fat and muscle maxima were each lowered to keep the total at 100). High blood glucose is collected and archived but not scored yet. The per-sex visceral level cut-offs previously in `src/model.js` are retired.

## Body composition

Body-composition calculations in TypeScript, including girth estimation. Results must match the committed golden vectors exactly. Only BIA fat %, waist and the inputs above feed the score; everything else is archived as comparison data.

## Bluetooth protocol (verified on device)

GATT service `FFB0`: write `FFB1`, notify `FFB2`, indicate `FFB3`. Packet layout: `idx, 00, len, 00, payload…, checksum` where checksum = sum(payload) & 0x1F and `len` counts the payload.

| Type | Direction            | Meaning                                                                                                                         |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AA` | scale → app          | device info, right after enabling `FFB3`                                                                                        |
| `A2` | scale → app (`FFB2`) | live weight: grams in payload bytes 3–5 (big-endian); status 01 measuring, 03 stable, 00 stepped off                            |
| `A7` | scale → app          | final record: time (BE seconds), weight grams, 10 impedances (BE ×0.1 Ω: trunk, LA, RA, LL, RL at 20 kHz then 100 kHz), user id |
| `A5` | scale → app          | stored offline record, same layout as `A7`                                                                                      |
| `A0` | scale → app          | acknowledgement of an app packet                                                                                                |
| `B0` | app → scale          | acknowledgement: replied packet index, state 0                                                                                  |
| `C0` | app → scale          | time + user profile (height, last weight ×100, sex bit 7 + age, user id)                                                        |
| `C1` | app → scale          | user list with the same profile                                                                                                 |

Device test findings:

- Impedances arrive without any handshake as long as the user holds the handle; the final record comes about 16 s after the weight is stable.
- After `C0`/`C1` with a DiaScale user id, the scale tags the next `A7` with that id.
- The scale resends unacknowledged records every 10 s and deletes acknowledged ones.

App behaviour: enable `FFB3` then `FFB2`; acknowledge every `AA`, `A5` and `A7`; send `C0`/`C1` after `AA`; ignore `A5` contents; accept only an `A7` carrying the DiaScale user id and non-zero impedances.

## Measurement flow

Connect → step on barefoot → live weight → hold the handle → wait for stable weight and impedances → result. Timeout 60 s. A timeout or missing impedances shows a failure with “Ulangi” and saves nothing. Every successful measurement is saved, with no daily limit.

Result screen: score, category, component points, the four required numbers and the waist (no “estimate” label). Comparison values are not shown.

## Profile

Name, phone (no OTP), birth date, sex (required, Laki-laki / Perempuan), height, antihypertensive medication, family history, high blood glucose. Waist is removed from the profile and its measuring guide is deleted. Each measurement stores a snapshot of the profile; old results are never recomputed. Height is entered as a whole number from 100 to 255 cm, matching the one-byte BLE profile field; health questions use Yes/No to match the archived booleans. Phone-based profile selection is local to the device and does not verify phone ownership.

## Data and server

- Offline-first: results are computed and stored on the phone, then synced. The phone's history is the source of truth; the server is an archive the app does not read back.
- Each measurement has a client-generated id; resending the same id does not create duplicates.
- Payload: full profile snapshot, the four numbers, raw inputs (weight, 10 impedances, height, age, sex), comparison values (BIA and RFM fat %, waist and other girths, visceral level, skeletal muscle), component points, total and category, raw BLE packets (hex), and versions `body` and `score`.
- Identity: a random account id and secret token per install; losing the phone loses its local history.
- Server: one Cloudflare Worker with D1 in the Dzakihamalafirdaus account, one environment, manual `wrangler deploy`, migrations in the repo.

## Stack and repository

- TypeScript with Capacitor for Android and iOS, keeping app id `com.diascale.app` and the existing iOS signing. Bluetooth through the Capacitor BLE plugin.
- Monorepo: `app/` (UI), `packages/core/` (protocol, body composition, score; shared by app and server), `server/` (Worker), `research/scale/` (measurement tools, captures and notes).

## Acceptance

For at least three measurements with the handle held, DiaScale's weight, body fat % and waist match FitDays+ exactly, and the four required numbers follow from them by the formulas above.

## Open items

- Paper section 4.2.1 should be updated to the new dataset results: sensitivity 91.8 % (729/794), specificity 45.9 % (3281/7149).
- A valid BIA versus RFM comparison needs measurements of 10–20 different people.

## Implementation status — 1 Nov 2026

The app now uses Capacitor 8, the Bluetooth LE plugin, the shared core calculations, and Preferences storage. An eight-second scan filters captured AC 2C subtype/electrode/algorithm advertising data; a connection additionally verifies the FG2504WB model through Device Information. The adapter enables FFB3 before FFB2, serializes packet processing/writes, and cancels after 60 seconds or when leaving the measurement flow/backgrounding the app. Only a complete ten-impedance result for this install and algorithm 43 can be saved.

Profile and full measurement snapshots persist locally. A result and its outgoing queue entry share one durable write; storage errors show a retry without claiming success. The main app no longer generates measurements, uses example profiles, or shows OTP/waist-entry forms. Its result categories and numbers come from the archived core record.

Sync is configured with build-time `VITE_ARCHIVE_URL` (empty by default). With an origin configured, install credentials are created and persisted before uploads, and queued measurements retry with exponential backoff. HTTP 200 duplicate and HTTP 201 creation remove the queued entry only when the response identifies the same result; permanent failures retain both history and queue. The archive exposes no history read-back.

Recorded-packet replay and local Workers runtime integration verify offline save → restart → sync and a response lost after D1 committed → retry → exactly one D1 row. These do not establish exact FitDays+ agreement for a new physical weighing. Deployment, direct scale tests, and physical phone acceptance remain deferred as requested.
