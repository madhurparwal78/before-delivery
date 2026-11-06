import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/client", sourcemap: false, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  esbuild: { jsx: "automatic" },
});
