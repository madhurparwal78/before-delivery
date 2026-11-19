// Builds the browser app into dist/client and copies Cesium's workers, wasm and assets beside it.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const engine = fileURLToPath(new URL("./node_modules/@cesium/engine/Build/", import.meta.url));
const out = fileURLToPath(new URL("./dist/client/", import.meta.url));

function cesiumStatic(): Plugin {
  return {
    name: "cesium-static",
    apply: "build",
    closeBundle() {
      for (const dir of ["Workers", "ThirdParty", "Assets"]) {
        cpSync(`${engine}${dir}`, `${out}cesium/${dir}`, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./client/", import.meta.url)),
  publicDir: "public",
  esbuild: { jsx: "automatic" },
  build: {
    outDir: out,
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
  },
  plugins: [cesiumStatic()],
});
