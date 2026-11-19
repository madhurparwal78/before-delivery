import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { shared: fileURLToPath(new URL("./src/shared", import.meta.url)) } },
  build: { outDir: "dist-app", emptyOutDir: true, target: "es2022" },
  server: { proxy: { "/api": "http://127.0.0.1:4173" } },
});
