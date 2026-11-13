import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
});
