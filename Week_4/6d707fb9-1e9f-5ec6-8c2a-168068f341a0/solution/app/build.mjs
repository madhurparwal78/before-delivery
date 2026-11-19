import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/assets", { recursive: true });
cpSync("public", "dist/assets", { recursive: true });

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});

await build({
  entryPoints: ["src/client/main.tsx"],
  outfile: "dist/assets/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
});
