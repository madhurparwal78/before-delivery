import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://127.0.0.1:4173";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/public", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  server: { proxy: { "/api": { target: api, changeOrigin: true, headers: { origin: api } } } },
});
