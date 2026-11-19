import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // The framework changes far less often than the app, so it is cached as its own chunk.
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? "vendor" : undefined),
      },
    },
  },
});
