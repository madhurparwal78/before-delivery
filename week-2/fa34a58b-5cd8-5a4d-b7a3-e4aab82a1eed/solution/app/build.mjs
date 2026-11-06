// Bundles the server and the browser code into dist/ and copies the static files.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
await build({
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox121", "safari17"],
  minify: true,
});
await cp("public", "dist/public", { recursive: true });
