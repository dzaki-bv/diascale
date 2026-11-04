import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Android uses Capacitor, BLE permissions without Android 12 location access, and network sync", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  for (const name of ["BLUETOOTH_SCAN", "BLUETOOTH_CONNECT", "INTERNET"])
    assert.ok(manifest.includes(`android.permission.${name}`));
  assert.match(manifest, /neverForLocation/);
  assert.match(manifest, /ACCESS_FINE_LOCATION" android:maxSdkVersion="30"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(
    await read("android/app/src/main/java/com/diascale/app/MainActivity.java"),
    /extends BridgeActivity/,
  );
  const plugins = await read("android/capacitor.settings.gradle");
  for (const plugin of [
    "capacitor-community-bluetooth-le",
    "capacitor-app",
    "capacitor-preferences",
  ])
    assert.ok(plugins.includes(plugin));
});

test("iOS retains signing overrides and includes BLE usage and Preferences privacy declarations", async () => {
  assert.match(
    await read("ios/Signing.xcconfig"),
    /PRODUCT_BUNDLE_IDENTIFIER = com.diascale.app/,
  );
  assert.match(await read("ios/debug.xcconfig"), /#include "Signing.xcconfig"/);
  assert.match(
    await read("ios/Signing.xcconfig"),
    /#include\? "Signing.local.xcconfig"/,
  );
  assert.match(
    await read("ios/App/App/Info.plist"),
    /NSBluetoothAlwaysUsageDescription/,
  );
  assert.match(await read("ios/App/App/PrivacyInfo.xcprivacy"), /CA92.1/);
  const project = await read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(project, /PrivacyInfo.xcprivacy in Resources/);
  assert.doesNotMatch(project, /DEVELOPMENT_TEAM = [A-Z0-9]{10}/);
  const plugins = await read("ios/App/CapApp-SPM/Package.swift");
  for (const plugin of [
    "CapacitorCommunityBluetoothLe",
    "CapacitorApp",
    "CapacitorPreferences",
  ])
    assert.ok(plugins.includes(plugin));
});
