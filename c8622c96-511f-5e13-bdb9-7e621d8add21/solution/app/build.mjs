// Builds the server bundle, the image worker and the browser app into dist/.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });

// The server packages are bundled into dist, so the shipped app has no install-time dependencies.
// pg's optional native binding is never used; the banner gives bundled CommonJS a real `require`.
const server = {
  bundle: true, platform: "node", target: "node22", format: "esm", external: ["pg-native"], logLevel: "warning",
  banner: { js: "import { createRequire as __createRequire } from \"node:module\"; const require = __createRequire(import.meta.url);" },
};
await build({ ...server, entryPoints: ["src/server/main.ts"], outfile: "dist/server.js" });
await build({ ...server, entryPoints: ["src/server/image-worker.ts"], outfile: "dist/image-worker.js" });

await build({
  entryPoints: { app: "src/client/main.ts" },
  outdir: "dist/public/assets",
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  sourcemap: false,
  loader: { ".woff2": "file" },
  logLevel: "warning",
});
await build({
  entryPoints: { app: "src/client/styles.css" },
  outdir: "dist/public/assets",
  bundle: true,
  minify: true,
  external: ["/fonts/*"],
  logLevel: "warning",
});
await cp("src/client/index.html", "dist/public/index.html");
await cp("public/fonts", "dist/public/fonts", { recursive: true });
