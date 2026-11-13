import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { outDir: "../../dist/client", emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
