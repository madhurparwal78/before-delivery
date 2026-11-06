import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: "public",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: { index: "src/client/index.html" },
    },
  },
  server: { middlewareMode: false },
});
