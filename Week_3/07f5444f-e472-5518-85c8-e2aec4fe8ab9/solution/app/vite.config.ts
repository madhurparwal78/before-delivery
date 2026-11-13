import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: "QW_CLIENT_",
  build: { outDir: "dist/client", sourcemap: false, emptyOutDir: true },
});
