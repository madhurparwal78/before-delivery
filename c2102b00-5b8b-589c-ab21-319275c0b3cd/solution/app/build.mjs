// Bundles the server and the browser client; copies the static files the server may serve.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });
await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});
await build({
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/public/assets/app.js",
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  logLevel: "warning",
});
await cp("public", "dist/public", { recursive: true });
