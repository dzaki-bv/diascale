import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.diascale.app",
  appName: "DiaScale",
  webDir: "../dist",
  android: { path: "../android" },
  ios: { path: "../ios" },
};

export default config;
