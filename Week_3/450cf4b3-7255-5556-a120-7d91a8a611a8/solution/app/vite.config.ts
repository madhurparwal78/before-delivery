import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0, target: "es2022" },
});
