import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", copyPublicDir: true },
  ssr: { noExternal: ["react-router-dom", "react-router", "yaml"] },
});
