import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true, sourcemap: false, target: "es2022" },
});
