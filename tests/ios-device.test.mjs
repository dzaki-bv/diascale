import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

async function installer(t, devices, permitted = null) {
  const root = await mkdtemp(join(tmpdir(), "diascale-signing-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "ios"));
  await mkdir(join(root, "bin"));
  await cp(
    new URL("../scripts/ios-device.mjs", import.meta.url),
    join(root, "scripts/ios-device.mjs"),
  );
  await writeFile(
    join(root, "ios/Signing.local.xcconfig"),
    "DEVELOPMENT_TEAM = ABCDE12345\nPRODUCT_BUNDLE_IDENTIFIER = id.example.diascale\n",
  );
  await writeFile(
    join(root, "devices.json"),
    JSON.stringify({ result: { devices } }),
  );
  const stub = `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.AUDIT,process.argv.slice(2).join(' ')+'\\n');if(process.argv[2]!=='devicectl'||process.argv[3]!=='list'||process.argv[4]!=='devices')process.exit(90);const at=process.argv.indexOf('--json-output');fs.copyFileSync(process.env.FIXTURE,process.argv[at+1]);`;
  await writeFile(join(root, "bin/xcrun"), stub, { mode: 0o755 });
  for (const command of ["xcodebuild", "npm", "codesign"])
    await writeFile(
      join(root, "bin", command),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.AUDIT,'UNEXPECTED ${command}\\n');process.exit(91);`,
      { mode: 0o755 },
    );
  if (permitted) {
    await mkdir(
      join(root, "ios/build-signed/Build/Products/Debug-iphoneos/DiaScale.app"),
      { recursive: true },
    );
    await writeFile(
      join(
        root,
        "ios/build-signed/Build/Products/Debug-iphoneos/DiaScale.app/embedded.mobileprovision",
      ),
      "fixture",
    );
    for (const command of [
      "xcrun",
      "xcodebuild",
      "npm",
      "codesign",
      "security",
      "plutil",
    ]) {
      const body =
        command === "xcrun"
          ? "if(process.argv[3]==='list'){const at=process.argv.indexOf('--json-output');fs.copyFileSync(process.env.FIXTURE,process.argv[at+1]);}"
          : command === "plutil"
            ? "fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],process.env.PERMITTED);"
            : "";
      await writeFile(
        join(root, "bin", command),
        `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.AUDIT,${JSON.stringify(command + " ")}+process.argv.slice(2).join(' ')+'\\n');${body}`,
        { mode: 0o755 },
      );
    }
  }
  return {
    run: (...args) =>
      spawnSync(
        process.execPath,
        [join(root, "scripts/ios-device.mjs"), ...args],
        {
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            PATH: join(root, "bin") + delimiter + process.env.PATH,
            FIXTURE: join(root, "devices.json"),
            AUDIT: join(root, "audit"),
            PERMITTED: JSON.stringify(permitted),
          },
        },
      ),
    audit: () => readFile(join(root, "audit"), "utf8"),
  };
}
const phone = (id) => ({
  identifier: id,
  hardwareProperties: { platform: "iOS", udid: `UDID-${id}` },
  deviceProperties: { developerModeStatus: "enabled" },
});

test("installation stops before signing when no iPhone is connected", async (t) => {
  const script = await installer(t, []);
  const result = script.run("--install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Belum ada iPhone/);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});
test("installation refuses to guess between multiple iPhones", async (t) => {
  const script = await installer(t, [phone("A"), phone("B")]);
  const result = script.run("--install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /beberapa perangkat/);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});
test("readiness check never invokes signing or installation for a ready phone", async (t) => {
  const script = await installer(t, [phone("A")]);
  const result = script.run("--check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /signing lokal siap/);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});
test("an explicit iPhone identifier disambiguates readiness checks", async (t) => {
  const script = await installer(t, [phone("A"), phone("B")]);
  const result = script.run("--check", "--device", "UDID-B");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});
test("disabled Developer Mode stops installation before provisioning", async (t) => {
  const device = phone("A");
  device.deviceProperties.developerModeStatus = "disabled";
  const script = await installer(t, [device]);
  const result = script.run("--install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Aktifkan Developer Mode/);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});
test("non-iOS devices are not selected for iPhone signing", async (t) => {
  const device = phone("A");
  device.hardwareProperties.platform = "macOS";
  const script = await installer(t, [device]);
  const result = script.run("--install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Belum ada iPhone/);
  assert.doesNotMatch(await script.audit(), /UNEXPECTED/);
});

test("a valid signed build excluding the selected iPhone is never installed", async (t) => {
  const script = await installer(t, [phone("A")], ["UDID-B"]);
  const result = script.run("--install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /belum mencakup iPhone/);
  assert.doesNotMatch(await script.audit(), /device install|process launch/);
});
test("a build provisioned for the selected iPhone is verified, installed, and launched", async (t) => {
  const script = await installer(t, [phone("A")], ["UDID-A"]);
  const result = script.run("--install");
  assert.equal(result.status, 0, result.stderr);
  const audit = await script.audit();
  assert.match(audit, /codesign --verify --deep --strict/);
  assert.match(audit, /device install app --device UDID-A/);
  assert.match(audit, /process launch --device UDID-A id.example.diascale/);
  assert.ok(
    audit.indexOf("codesign --verify") < audit.indexOf("device install"),
  );
});
