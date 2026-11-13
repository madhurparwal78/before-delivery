import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  esbuild: { jsx: "automatic" },
  build: { outDir: "../../dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
});
