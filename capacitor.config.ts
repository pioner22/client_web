import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.yagodka.app",
  appName: "Yagodka",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
