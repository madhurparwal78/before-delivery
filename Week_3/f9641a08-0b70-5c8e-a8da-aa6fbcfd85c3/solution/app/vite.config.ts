import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [react()],
  build: {
    outDir: "../../dist/public",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
