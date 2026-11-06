import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser bundle never reads the server environment: no variable uses this prefix.
export default defineConfig({
  root: "src/client",
  envPrefix: "FLUXSEAL_BROWSER_NONE_",
  plugins: [react()],
  build: { outDir: "../../dist/client", emptyOutDir: true, assetsInlineLimit: 0 },
});
