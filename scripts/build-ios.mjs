import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const project = fileURLToPath(new URL("../", import.meta.url));
const defaultXcode = "/Applications/Xcode.app/Contents/Developer";
const env = { ...process.env };
if (!env.DEVELOPER_DIR && existsSync(defaultXcode))
  env.DEVELOPER_DIR = defaultXcode;
const sdk = process.argv.includes("--device") ? "iphoneos" : "iphonesimulator";
const products = resolve(project, "ios/build/Build/Products");
// Generic destinations need no paired phone; Xcode platform components must be installed.
const args = [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  "Debug",
  "-sdk",
  sdk,
  "-destination",
  sdk === "iphoneos"
    ? "generic/platform=iOS"
    : "generic/platform=iOS Simulator",
  `CONFIGURATION_BUILD_DIR=${resolve(products, `Debug-${sdk}`)}`,
  `OBJROOT=${resolve(project, "ios/build/Intermediates")}`,
  `SYMROOT=${products}`,
  "CODE_SIGNING_ALLOWED=NO",
  ...(sdk === "iphonesimulator"
    ? [`ARCHS=${process.arch === "arm64" ? "arm64" : "x86_64"}`]
    : []),
  "build",
  "-quiet",
];
const result = spawnSync("xcodebuild", args, {
  cwd: project,
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (sdk === "iphonesimulator") {
  const signature = spawnSync(
    "codesign",
    [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      resolve(products, `Debug-${sdk}`, "DiaScale.app"),
    ],
    { stdio: "inherit" },
  );
  if (signature.error) throw signature.error;
  if (signature.status !== 0) process.exit(signature.status ?? 1);
}
console.log(
  `Built DiaScale for ${sdk}: ${resolve(products, `Debug-${sdk}`, "DiaScale.app")}`,
);
if (sdk === "iphoneos")
  console.log("Device installation requires Apple signing.");
