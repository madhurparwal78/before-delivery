import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022"
  },
  server: {
    port: 5173
  }
});
