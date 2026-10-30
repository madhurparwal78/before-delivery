import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        index: "index.html",
        manage: "manage.html",
        share: "share.html",
        signin: "signin.html",
        privacy: "privacy.html",
        notfound: "notfound.html",
      },
    },
  },
});
