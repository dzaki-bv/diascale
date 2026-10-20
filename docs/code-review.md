# Implementation review

Baseline: `7b3c9062a36c6b6f10d00d37c1158dc8f5003aff`. Review limited to staged/current DiaScale files; the enclosing repository is rooted outside this project. Requirements: `docs/implementation-spec.md` and the user's session instructions.

Two independent review agents inspected Standards and Spec. No tests, browser QA, or ADB inspection was performed by the reviewers.

## Standards

Initial correctness finding: logout and subsequent account entry could retain another phone account's profile and history. Resolved with normalized-phone in-memory accounts, explicit session clearing, and copied profile/contribution snapshots. Follow-up source review found no remaining substantive issue in these changes. No repository standards violations identified.

## Spec

Initial findings: single-device/no-device scanning could not be selected through the review controls; displayed contribution totals did not agree with scores. Resolved with explicit external scanning scenario entries and a per-result example-data factory capturing contributions and their exact total. Follow-up source review found no remaining findings. The example factory is not a clinical risk algorithm.

## Delivery evidence

Vite production bundling and Android debug APK compilation completed successfully. ADB reported a successful installation on TECNO CM7 (140892556G002681) and accepted the launch request for `com.diascale.app/.MainActivity`. Automated tests and UI verification were intentionally omitted at the user's request.

The first APK was installed and launched successfully before review. After the review fixes, the final APK also compiled successfully, but its replacement installation could not run because the device disconnected and `adb devices -l` returned no attached devices. Reconnect the phone to install the reviewed build; do not treat the earlier installed APK as the final reviewed version.

The device subsequently reconnected. The final reviewed APK was installed successfully on TECNO CM7 using `adb -s 140892556G002681 install --user 0 -r .../app-debug.apk`; ADB then accepted the launch request for `com.diascale.app/.MainActivity`. No UI tests or inspection followed.

## iOS follow-up review

Baseline: `e3128df`. Two independent source reviews covered the iOS project, offline bundling scripts, package scripts, and ignore rules against the iOS follow-up in `docs/implementation-spec.md`.

### Standards

No substantive findings. Local navigation allowlisting, nonpersistent WKWebView storage, HTML/CSS delimiter escaping, bundled font resolution, SwiftUI safe areas, Xcode resource references, and argument-based build commands were inspected. The simulator artifact receives local ad-hoc signing without an Apple identity; the physical-device build stays unsigned.

### Spec

No findings. The app reuses the approved frontend offline, targets iOS/iPadOS 16+, hides the desktop frame/controls, preserves native safe areas, and introduces no backend or Bluetooth implementation. Documentation distinguishes unsigned iPhone output from an installable signed distribution.

### Build evidence

Both target/SDK builds completed successfully: `iphoneos` and `iphonesimulator`. No iPhone or installed simulator runtime was available. Generic-destination compilation initially failed due to the missing simulator runtime; target/SDK compilation with ordinary PNG icon resources avoids that runtime dependency. The simulator app was ad-hoc signed and both outputs were zipped under `output/ios/`. No tests, UI inspection, simulator launch, or physical installation was performed.

## Automated testing and free-account signing follow-up

Baseline: `8edbbe1`. The user explicitly authorized tests and confirmed a free Apple Account. Two independent source reviews covered the test harness/suites, focused phone-validation fix, package scripts, and signing guidance.

### Standards

No application regression found. One coverage gap was identified: letters alone were blocked by HTML validation before reaching the normalized-number guard. The regression test now additionally submits invalid numeric inputs, checks validation feedback, corrects the number, and verifies successful OTP navigation. The controlled timer harness covers callback ordering/cancellation; it does not simulate Date.now or claim date-dependent clock coverage.

### Spec

No findings. Tests execute the actual bundled iOS JavaScript in jsdom, account model, and packaging CLI; documentation distinguishes these from native UI/WKWebView testing. Signing guidance uses current Apple sources for Personal Team, automatic signing, device pairing, 7-day provisioning, and paid TestFlight. No Apple login, device registration, certificate provisioning, or installation was performed.

### Evidence

Final `npm test`: 22 passed, 0 failed, 0 skipped. iPhone and simulator builds succeeded; refreshed archives are in `output/ios/`. Native UI remains untested because no iPhone or installed simulator runtime is available.
