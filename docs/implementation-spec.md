# DiaScale frontend and Android handoff

Source of truth: the user's design interview and subsequent screenshot edits in this session. This is a frontend-only implementation of the selected design. No backend, real OTP transport, Bluetooth integration, or validated diabetes risk algorithm is authorized in this scope.

## User-facing behavior

- Indonesian UI for users operating their own phone at home or in hospital.
- Phone signup/login with a six-digit OTP interface. Follow signup with two mandatory profile steps: full name, birth date, height, waist circumference; then antihypertensive use, history of high blood glucose, and family diabetes history. Health answers include Yes, No, and Unknown.
- Home uses the selected clinical card combining diabetes type 2 risk, a measurement action, and secondary body metrics. Risk is the primary information throughout the app. No alternate designs or color selectors.
- Risk trend below the home card uses 0–100 scores across measurements and dd/mm dates. Remove extra chart captions, per-date score summaries, lifestyle tips, and the redundant history shortcut.
- Scanning: one nearby unit connects automatically; several units require selection by unit number. Provide searching, no-device, disconnection, measuring, and measurement-failure views with retries. Measurement stages advance without a button after stepping on the scale.
- Result layout: category left, score ring right, risk scale below. Show a compact white/blue contribution table with larger text, raw values, and aligned point badges. Positive points are red, zero is neutral. Show body measurements as secondary information with no redundant separator. Preserve the health-data snapshot associated with the historical result. Do not show the deleted recommendation section.
- History: graph and rows show risk score/category, not weight as the primary measure. No leading row icons. Period filters and result drilldown work.
- Profile can be edited; edits affect subsequent measurements and do not rewrite historical profile snapshots.
- Keep the desktop mobile canvas at 390 × 844 layout pixels, scaled to fit the viewport; only inner content scrolls. Keep the requested external page picker for web review.
- The app must contain no simulation labels or editorial notes. The README must accurately document that data and integrations are examples.

## Android request

The user subsequently requested direct installation through ADB. The only connected device was TECNO CM7, serial 140892556G002681. Install a self-contained offline Android APK under a new DiaScale package. Native viewport uses the full phone screen, without a second phone frame, duplicate status bar, or desktop review controls. Fonts and web assets must be bundled.

## Delivery constraints

The user explicitly requested no tests or browser QA; respect that instruction. Compilation and APK packaging are necessary for installation. Perform code review and commit project files only on the current branch, as requested by the implement skill. The enclosing Git repository is rooted at /Users/perry; do not stage unrelated home-directory files, source PDF, dataset, build output, or machine-specific SDK paths.

## iOS follow-up

The user requested an iOS version after Android delivery. Reuse the approved frontend in a SwiftUI/WKWebView app supporting iOS 16+, with bundled offline content/fonts, native safe areas, no duplicate desktop frame or controls, and no backend/native Bluetooth integration. Prepare an Xcode project plus simulator and unsigned device builds. Do not claim physical installation or a signed distributable without an attached device and Apple provisioning. Keep the user's no-tests/no-UI-QA instruction.

## Testing and signing follow-up

The user now explicitly requests tests and signing guidance for a friend’s iPhone, and confirms using a free Apple Account. This supersedes the earlier no-tests restriction. Test existing public account, interaction, and packaging boundaries; fix reproduced failures without adding backend or real Bluetooth. Provide Personal Team/Xcode steps and expiry limitations with current Apple sources; distinguish this from paid TestFlight. Do not sign into an Apple account or register a device without the required user inputs.
