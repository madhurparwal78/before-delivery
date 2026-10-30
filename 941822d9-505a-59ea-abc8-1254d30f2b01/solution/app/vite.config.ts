import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "public",
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist/web", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
});
