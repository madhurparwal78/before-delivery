import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
