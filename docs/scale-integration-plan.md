# Scale integration plan

Implements `docs/scale-integration-spec.md`. Each phase ends with passing tests and its own commit. Phases 1 and 4 need no phone or scale.

Progress, 1 Nov 2026: Phases 0 and 1 are committed. Phase 2 native migration, Phase 3 app features, Phase 4 archive API and Phase 5 sync are implemented locally and uncommitted. Android debug, unsigned iPhone and ad-hoc-signed iOS simulator builds pass. The required iOS 26.5 universal platform is installed; simulator launch remains unverified because initial CoreSimulator setup exhausted the available resource budget and was stopped. No physical phones are connected. Phase 6 is covered by recorded-packet and local Worker/D1 tests where possible; real weighings and remote delivery remain deferred.

The user authorized all work except direct scale testing and deployment. No remote D1 creation/migration or Worker deployment is performed. Commits are made only when requested.

## Phase 0 — Monorepo layout

- Switch to npm workspaces: move the Vite app (`index.html`, `src/`, `vite.config.js`, `prototype/`, UI tests) into `app/`; create `packages/core/` and `server/`.
- Move the measurement workspace into `research/scale/`: calculation and verification scripts, standard tables, device captures, the GATT probe, and measurement notes.
- Keep `npm test` green and the existing Android/iOS builds working before anything else moves.

## Phase 1 — `packages/core` (pure TypeScript)

1. **Protocol**: parse `AA`, `A0`, `A2`, `A5`, `A7`; build `B0`, `C0`, `C1`; checksum. Tests use the real packets captured in the 20:46 session and device tests A and B.
2. **Scale session**: a state machine fed with packets that emits the packets to write and the events for the UI (connected, live weight, stable, need handle, result, failure, timeout). Tests replay the recorded sequences from tests A and B.
3. **Body composition**: implement body composition, girth and standard tables with float32 and fused multiply-add semantics. Commit about 500 golden vectors; the implementation must match every value exactly.
4. **Score**: the paper rules from the spec. Tests: run the component rules on every row of `dataset/dataset.csv` (using its own visceral, fat %, BMI, muscle and medication columns) and require each `RASIO …` column and `FINAL_RASIO` to match; plus device-input cases for BIA fat % and girth waist.
5. **Measurement record**: build the archived payload (profile snapshot, four numbers, raw inputs, comparison values, points, category, raw packets, versions) with a client id.

## Phase 2 — Capacitor

- Add Capacitor to `app/`, generate `android/` and `ios/` projects with app id `com.diascale.app`, carry over the iOS signing configuration and app icon, and retire the hand-written WebView wrappers and their sync scripts.
- Add the Capacitor BLE plugin and the Bluetooth permissions (Android `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, iOS usage description). Add network access for sync.
- Verify the app launches on the TECNO CM7 and the connected iPhone with the current screens unchanged.

## Phase 3 — App features

- **Profile**: add required sex; remove waist and its guide from forms, profile and result screens; refuse birth dates under 18; drop the OTP screen and keep the phone number as a plain field.
- **Measurement**: BLE adapter connecting the plugin to the core scale session; screens for connect, live weight, hold the handle, timeout and failure with “Ulangi”.
- **Result and history**: score, category (Aman / Meningkat / Waspada), component points, the four numbers and waist; history from local storage; profile snapshot per record.
- **Local storage**: persist profile, account credentials, history and the outgoing queue on the device (Capacitor Preferences unless volume requires SQLite).
- Replace example fixtures in `model.js` with real records; keep UI tests passing against recorded measurements.

## Phase 4 — `server/` (Cloudflare Worker + D1)

- D1 migrations: `accounts` (id, token hash, created_at) and `measurements` (client id primary key, account id, measured_at, the four numbers, score, category, body and score versions, full JSON payload, received_at).
- Endpoints: `POST /v1/accounts` returns a new id and token; `POST /v1/measurements` authenticated by bearer token, validated, idempotent on client id; reuse `packages/core` types and optionally recompute to flag mismatches.
- Tests with the Workers test runner; deploy manually with `wrangler deploy` to the Dzakihamalafirdaus account.

## Phase 5 — Sync

- Create the account on first launch, store id and token locally.
- Queue every saved measurement; send when online, retry with backoff, remove on success or on a duplicate response.

## Phase 6 — Device acceptance

- Three measurements with the handle held on Android and on iPhone; compare weight, body fat % and waist with FitDays+ for the same weighing and check the four numbers and score.
- Confirm records reach D1 exactly once after an offline period.
- Update `README.md`, `docs/testing.md` and the spec with what was verified.
