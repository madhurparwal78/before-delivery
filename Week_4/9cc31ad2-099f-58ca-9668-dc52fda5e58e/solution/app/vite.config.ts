import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: false,
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
