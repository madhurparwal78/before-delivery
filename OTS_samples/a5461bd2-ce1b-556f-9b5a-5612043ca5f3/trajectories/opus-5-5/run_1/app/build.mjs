import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fonts } from "./fonts.mjs";

execFileSync("node_modules/.bin/tsc", ["--noEmit", "-p", "tsconfig.json"], { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/public/assets/fonts", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.ts", "app-style": "static/app.css" },
  outdir: "dist/public/assets",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  external: ["/assets/fonts/*"],
  logLevel: "warning",
});

for (const font of fonts) {
  copyFileSync(`node_modules/@fontsource/${font.pkg}/files/${font.file}`, `dist/public/assets/fonts/${font.file}`);
}
