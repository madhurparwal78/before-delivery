import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "client");

export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        journey: resolve(root, "journey.html"),
        proposal: resolve(root, "proposal.html"),
        console: resolve(root, "console.html"),
      },
    },
  },
});
