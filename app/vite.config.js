import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // Capacitor copies the shared production bundle into both native projects.
  build: { target: "es2020", outDir: "../dist", emptyOutDir: true },
});
