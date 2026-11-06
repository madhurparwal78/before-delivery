import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "warning",
});
await build({
  entryPoints: ["src/client/main.tsx"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  minify: true,
  logLevel: "warning",
});
await cp("public", "dist/public", { recursive: true });
