import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
if (
  !env.DEVELOPER_DIR &&
  existsSync("/Applications/Xcode.app/Contents/Developer")
) {
  env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
}
const temporary = await mkdtemp(join(tmpdir(), "diascale-ios-device-"));
const installing = process.argv.includes("--install");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} tidak berhasil (exit ${result.status}).`);
}

try {
  const configuration = resolve(root, "ios/Signing.local.xcconfig");
  if (!existsSync(configuration)) {
    throw new Error(
      "Pilih Personal Team di Xcode atau buat ios/Signing.local.xcconfig berdasarkan ios/Signing.local.xcconfig.example.",
    );
  }
  const settings = await readFile(configuration, "utf8");
  const team = settings.match(
    /^\s*DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10})\s*$/m,
  )?.[1];
  const bundle = settings.match(
    /^\s*PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([A-Za-z0-9.-]+)\s*$/m,
  )?.[1];
  if (!team || !bundle)
    throw new Error(
      "Isi DEVELOPMENT_TEAM dan PRODUCT_BUNDLE_IDENTIFIER pada konfigurasi signing lokal.",
    );
  const listing = join(temporary, "devices.json");
  run("xcrun", ["devicectl", "list", "devices", "--json-output", listing]);
  const payload = JSON.parse(await readFile(listing, "utf8"));
  if (!Array.isArray(payload.result?.devices))
    throw new Error(
      "Daftar perangkat Xcode tidak memiliki format yang diharapkan.",
    );
  const devices = payload.result.devices.filter(
    (device) => device.hardwareProperties?.platform === "iOS",
  );
  const requestedIndex = process.argv.indexOf("--device");
  const requested =
    requestedIndex >= 0 ? process.argv[requestedIndex + 1] : null;
  if (requestedIndex >= 0 && !requested)
    throw new Error("Tambahkan identifier setelah --device.");
  const matches = requested
    ? devices.filter(
        (device) =>
          device.identifier === requested ||
          device.hardwareProperties?.udid === requested,
      )
    : devices;
  if (!matches.length) {
    throw new Error(
      "Belum ada iPhone/iPad yang cocok terdeteksi. Sambungkan USB, buka kunci iPhone, pilih Trust This Computer, lalu coba lagi.",
    );
  }
  if (matches.length !== 1) {
    throw new Error(
      "Ada beberapa perangkat iOS. Pilih secara eksplisit: npm run ios:install -- --device IDENTIFIER.",
    );
  }
  const device = matches[0];
  const identifier = device.hardwareProperties?.udid || device.identifier;
  if (!identifier)
    throw new Error(
      "Identifier perangkat belum tersedia. Selesaikan pairing di Xcode.",
    );
  if (device.deviceProperties?.developerModeStatus === "disabled") {
    throw new Error(
      "Aktifkan Developer Mode di iPhone, ikuti restart/konfirmasi, lalu jalankan ulang.",
    );
  }
  console.log(
    "Konfigurasi signing lokal siap dan satu perangkat iOS terdeteksi.",
  );
  if (installing) {
    console.log(
      "Membuat provisioning development melalui akun Xcode, menandatangani, lalu memasang DiaScale.",
    );
    run("npm", ["run", "ios:sync"]);
    const derived = resolve(root, "ios/build-signed");
    run("xcodebuild", [
      "-project",
      "ios/DiaScale.xcodeproj",
      "-target",
      "DiaScale",
      "-sdk",
      "iphoneos",
      "-configuration",
      "Debug",
      `CONFIGURATION_BUILD_DIR=${resolve(derived, "Build/Products/Debug-iphoneos")}`,
      `OBJROOT=${resolve(derived, "Intermediates")}`,
      `SYMROOT=${derived}`,
      "-allowProvisioningUpdates",
      "-allowProvisioningDeviceRegistration",
      `DEVELOPMENT_TEAM=${team}`,
      `PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,
      "CODE_SIGN_STYLE=Automatic",
      "CODE_SIGNING_ALLOWED=YES",
      "build",
      "-quiet",
    ]);
    const app = resolve(derived, "Build/Products/Debug-iphoneos/DiaScale.app");
    if (!existsSync(resolve(app, "embedded.mobileprovision"))) {
      throw new Error(
        "Build belum memiliki provisioning profile untuk perangkat. Periksa akun dan Personal Team di Xcode.",
      );
    }
    const decodedProfile = join(temporary, "profile.plist");
    const provisionedDevices = join(temporary, "provisioned-devices.json");
    run("security", [
      "cms",
      "-D",
      "-i",
      resolve(app, "embedded.mobileprovision"),
      "-o",
      decodedProfile,
    ]);
    run("plutil", [
      "-extract",
      "ProvisionedDevices",
      "json",
      "-o",
      provisionedDevices,
      decodedProfile,
    ]);
    const permitted = JSON.parse(await readFile(provisionedDevices, "utf8"));
    if (!Array.isArray(permitted) || !permitted.includes(identifier)) {
      throw new Error(
        "Profil signing belum mencakup iPhone yang dipilih. Pilih iPhone itu sebagai run destination di Xcode, selesaikan automatic provisioning, lalu coba lagi.",
      );
    }
    run("codesign", ["--verify", "--deep", "--strict", app]);
    run("xcrun", [
      "devicectl",
      "device",
      "install",
      "app",
      "--device",
      identifier,
      app,
    ]);
    run("xcrun", [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      identifier,
      bundle,
    ]);
    console.log(
      "DiaScale bertanda tangan berhasil dipasang dan diminta untuk dibuka.",
    );
  } else {
    console.log(
      "Jalankan npm run ios:install untuk melanjutkan signing dan instalasi.",
    );
  }
} catch (error) {
  console.error(error.message);
  console.error(
    "Jika Xcode meminta login/persetujuan atau konfirmasi di iPhone, selesaikan langkah itu sendiri lalu jalankan ulang.",
  );
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
