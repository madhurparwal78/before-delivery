import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The service worker is its own entry, emitted at /sw.js so its scope is the whole app.
// After bundling, the list of every emitted file is written into it, so the shell, the
// scripts, the styles and the fonts can be precached for opening a job with no signal.
function precacheManifest(): Plugin {
  return {
    name: "snaglight-precache-manifest",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name !== "sw.js" && !name.endsWith(".map"))
        .map((name) => `/${name}`);
      const urls = ["/", ...files.filter((name) => name !== "/index.html")];
      const version = createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 12);
      const worker = bundle["sw.js"];
      if (worker?.type !== "chunk") throw new Error("service worker entry missing from the bundle");
      worker.code = worker.code
        .replace('"__PRECACHE_URLS__"', JSON.stringify(urls))
        .replace("__PRECACHE_VERSION__", version);
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { app: "index.html", sw: "src/client/sw.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
