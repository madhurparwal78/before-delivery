import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist/web", emptyOutDir: true, target: "es2022", sourcemap: false },
});
