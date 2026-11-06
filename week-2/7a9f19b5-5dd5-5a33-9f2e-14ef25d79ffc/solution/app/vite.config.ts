import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Libraries in their own chunk, preloaded by the page alongside the app entry.
        manualChunks(id) {
          return id.includes("node_modules") ? "vendor" : undefined;
        },
      },
    },
  },
});
