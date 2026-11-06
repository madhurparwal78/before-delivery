import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, target: "es2022" },
});
