import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  plugins: [preact()],
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: { port: 5180, strictPort: true }
});
