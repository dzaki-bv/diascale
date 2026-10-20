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
