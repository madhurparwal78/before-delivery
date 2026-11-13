import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false, target: "es2022", assetsInlineLimit: 0 },
  server: { host: "127.0.0.1" },
});
