import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
});
