import { defineConfig } from "vite";

// Builds the browser client into dist/client; the server serves only that folder.
export default defineConfig({
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
