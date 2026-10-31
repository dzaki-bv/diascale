# Automated testing

The user explicitly requested tests on 2026-10-21, superseding the earlier no-tests instruction.

## Run

```sh
npm test
```

The command builds the current frontend, creates the offline iOS HTML, then runs Node's test runner. Individual suites can be run with `node --test app/tests/model.test.mjs`, `node --test app/tests/app.test.mjs`, `node --test tests/ios-bundle.test.mjs`, and `node --test tests/ios-device.test.mjs`. The app suite requires a fresh `npm run ios:sync` after frontend edits.

## Behavior boundaries

- Account/session and recorded-result interface: phone normalization, account isolation/restoration, profile and contribution snapshots, coherent example totals.
- User interaction interface: execute the production iOS bundle in jsdom and drive form submissions/buttons. Cover required signup/OTP fields, phone validation, measurement unit selection, single/no-device scenarios, cancellation, retry, history, profile editing, and risk-first presentation.
- iOS device CLI: stop before signing for missing/ambiguous/non-iOS devices and disabled Developer Mode; check-only mode never provisions or installs. External commands are isolated by test fixtures.
- iOS packaging CLI: inline script/style/font assets, preserve script-like strings safely, and reject assets outside the bundle or unsupported multiple JS entries.

The DOM harness advances scheduled example-device events without waiting in real time. It does not replace real measurement data or implement a clinical scoring algorithm.

## Limits

DOM tests are not Safari/WKWebView or native-device UI tests. They do not validate visual layout, actual SMS/Bluetooth, clinical accuracy, Apple signing/provisioning, or physical installation. Native code is compiled for iPhone and simulator separately. Native runtime tests require an attached iPhone or an installed simulator runtime, now being prepared separately from the automated DOM tests.

## Regression discovered

The first phone-validation regression test failed: letters could advance to OTP because the input pattern did not reliably reject them. The input pattern and normalized-number guard were corrected before rerunning the test. The latest production iOS bundle, rather than an archived prototype, is what the interaction suite executes.

## Latest result

2026-10-21: `npm test` completed with **30 passed, 0 failed, 0 skipped**: 8 model tests, 11 production-bundle DOM interaction tests, 3 packaging CLI tests, and 8 device CLI checks. Phone validation also covers pattern-valid but invalid numeric inputs and recovery after correcting the value. Both `node scripts/build-ios.mjs` and `node scripts/build-ios.mjs --device` completed successfully after the application fix. The simulator and unsigned device ZIPs were refreshed. A real development build also completed signing after selecting the logged-in Personal Team in Xcode; physical installation succeeded after pairing and Developer Mode. After owner trust of the developer profile, devicectl launch succeeded and the user confirmed DiaScale opened. Native UI flows have not been exhaustively exercised.
