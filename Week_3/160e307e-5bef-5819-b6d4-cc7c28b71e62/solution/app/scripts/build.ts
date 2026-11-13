import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

/** Bundles the server (dependencies stay external) and the browser client into dist/. */

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outfile: "dist/server.mjs",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.ts" },
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  outdir: "dist/public",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/styles/main.css" },
  bundle: true,
  minify: true,
  external: ["/fonts/*"],
  outdir: "dist/public",
  logLevel: "warning",
});

cpSync("public/fonts", "dist/public/fonts", { recursive: true, filter: (source) => !source.endsWith(".txt") });
cpSync("src/client/index.html", "dist/public/index.html");
