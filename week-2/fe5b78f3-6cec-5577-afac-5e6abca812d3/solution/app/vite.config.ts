import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  esbuild: { jsx: "automatic" },
  build: { outDir: "../../dist/client", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
});
