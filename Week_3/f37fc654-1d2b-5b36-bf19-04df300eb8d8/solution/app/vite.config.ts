import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist/client", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
});
