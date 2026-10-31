import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // The native wrappers package the bundle from the repository-level dist/.
  build: { target: "es2020", outDir: "../dist", emptyOutDir: true },
});
