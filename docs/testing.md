# Automated testing

Tests were explicitly requested by the user on 21 Oct 2026. The scale-integration work now replaces the earlier simulated measurement and OTP tests with recorded real-packet flows.

## Run

```sh
npm test
npm run check -w app
npm run check -w server
npm run build -w server
```

The root command builds Vite, adapts the production JavaScript graph into an IIFE for jsdom (`scripts/bundle-test.mjs`, ignored `tmp/dom/index.html`), runs Node tests, then runs the archive tests with Cloudflare's Workers Vitest plugin. jsdom cannot execute module scripts, so only the test artifact uses IIFE conversion; native apps load the original Vite module assets through Capacitor. No inline iOS bundler or legacy WebView wrapper is used.

Individual runs:

```sh
node --test app/tests/model.test.mjs
node --test app/tests/scale.test.ts app/tests/storage.test.ts app/tests/sync.test.ts
npm test -w packages/core
npm test -w server
```

Before running `app/tests/app.test.mjs` directly, rebuild with `npm run build && node scripts/bundle-test.mjs`. Test runtime: Node 26 with native TypeScript stripping.

## Coverage

- Core: checksums, profile handshake, real scale packet replay, user-ID isolation, missing handle and timeout; 500 body-composition golden vectors; score components and category against all 8,165 dataset rows; archived measurements and profile snapshots.
- BLE adapter: captured manufacturer data, discovery deduplication, model verification, FFB3-before-FFB2 subscriptions, serialized acknowledgments/writes, complete device-test-B result, missing/partial impedances, algorithm mismatch, disconnect, timeout, and cancellation during native initialization/cleanup. No radios or live scale are used.
- Storage: profile, raw history, installation identity and queue survive reopening; a result and outbox entry are atomic; failed saves can retry; concurrent writes retain both records; changed profiles leave historical snapshots intact; unreadable storage is not overwritten.
- Sync: account creation is persisted before uploads, offline delivery and duplicate responses, retry backoff with the same result ID, permanent errors retained without changing installation identity, overlapping flushes, invalid success responses, and failed local acknowledgment after remote success.
- Production DOM: required personal/health fields and adult validation, no OTP or waist entry, real captured result with all four numbers and calculated waist, durable storage and reload, old profile snapshots, cancellation/disconnect/timeout, real discovered device lists, local save recovery, profile isolation, and unknown-number login without fabricated history.
- Archive: account/token hash storage, authentication, structural validation, full payload preservation, immutable duplicates, simultaneous requests for the same ID, cross-account collisions, Capacitor CORS, byte limits, and absence of read APIs. SQL migrations execute against D1 in the Workers runtime.
- App-to-archive integration: the actual app store and sync engine send a recorded result to the real Worker handler and D1. A response is lost after the insert commits; reopening the app store and retrying returns a duplicate, drains only the queue, retains local history, and leaves exactly one D1 measurement and one installation account.
- Native configuration: generated projects include the BLE/Preferences/App plugins, Android scan/connect/network permissions, restricted pre-Android-12 location access, preserved signing overrides, iOS Bluetooth usage description and Preferences privacy declaration.
- iOS installer: refuses missing/ambiguous/non-iOS devices and disabled Developer Mode; readiness-only runs do not sign/install; physical provisioning must include the selected device.

## Verification — 1 Nov 2026

The root suite passed **82 tests** (59 Node tests and 23 Workers runtime tests). App/server TypeScript checks, Worker dry-run bundle and local D1 migration also passed. Android Capacitor debug APK builds successfully with Java 21. Both the unsigned iPhone build and ad-hoc-signed iOS simulator build passed with Xcode after installing the universal iOS 26.5 platform. A separate HTTP smoke test against `wrangler dev` on localhost created and persisted an install account, drained its queue, and retained the original local result. This used only local D1, without remote resources or deployment.

## Limits and deferred acceptance

The DOM bridge is a test double, not an Android WebView or Safari. Packet replay verifies software behavior, not fresh body-composition agreement with FitDays+. The app is a prototype, and these tests do not validate clinical accuracy. Preferences persists the full history in one document; high-volume storage performance has not been benchmarked.

The simulator launch check was stopped during initial CoreSimulator migration because memory/swap pressure reduced available disk space. Simulator compilation passed, but installation/launch is not counted as verified. The newly booted test device was shut down and erased. No Android/iPhone is currently connected. Physical installation/launch on the new Capacitor shells, three new weighings per platform, exact FitDays+ comparisons and delivery to deployed D1 remain unverified. The user explicitly deferred direct scale testing and all deployment work. Complete these only after that scope is reopened. The archive URL is empty by default, so the shipped local build does not contact a server.

## Historical native result

On 21 Oct 2026, the former SwiftUI/WKWebView build was signed, installed and launched on an iPhone after owner trust and Developer Mode. That result describes the retired wrapper; it does not establish acceptance for the new Capacitor build.
