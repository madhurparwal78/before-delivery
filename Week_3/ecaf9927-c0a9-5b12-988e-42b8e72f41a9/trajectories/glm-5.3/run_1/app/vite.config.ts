import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/app",
  publicDir: "public",
  plugins: [react()],
  build: {
    outDir: "../../dist/app",
    emptyOutDir: true,
    assetsInlineLimit: 0
  }
});
