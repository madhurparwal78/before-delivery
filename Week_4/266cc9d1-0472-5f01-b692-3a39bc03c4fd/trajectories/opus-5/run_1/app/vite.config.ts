import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CESIUM_STATIC = ["Workers", "Assets", "ThirdParty", "Widgets"];

/** Copies Cesium's worker, asset and style files so nothing is fetched remotely. */
function cesiumStatic(): Plugin {
  return {
    name: "spanwise-cesium-static",
    apply: "build",
    closeBundle() {
      const from = path.resolve("node_modules/cesium/Build/Cesium");
      const to = path.resolve("dist/web/cesium");
      mkdirSync(to, { recursive: true });
      for (const folder of CESIUM_STATIC) {
        cpSync(path.join(from, folder), path.join(to, folder), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), cesiumStatic()],
  publicDir: "public",
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium/"),
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4173",
    },
  },
});
