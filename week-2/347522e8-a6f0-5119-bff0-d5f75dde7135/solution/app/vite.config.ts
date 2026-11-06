import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  base: "/",
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      // lucide-react marks its modules "use client" for React Server Components; a client bundle has no use for it.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
