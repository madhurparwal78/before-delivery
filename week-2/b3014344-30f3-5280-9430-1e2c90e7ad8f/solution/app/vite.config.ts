import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 1000, // three.js is one ~750 kB chunk, loaded after the pricing controls
  },
});
