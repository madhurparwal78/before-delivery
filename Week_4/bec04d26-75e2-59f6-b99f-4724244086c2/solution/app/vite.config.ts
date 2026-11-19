import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0, target: "es2022" },
});
