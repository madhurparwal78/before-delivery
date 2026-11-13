import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  plugins: [react()],
  // three.js is most of the bundle, and every route needs it: one canvas sits behind them all and never reloads.
  build: { outDir: "../dist/client", emptyOutDir: true, target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 1000 },
});
