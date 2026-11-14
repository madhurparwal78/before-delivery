import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/public/fonts", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "warning",
});

const fonts = [
  ["@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2", "noto-sans-400.woff2"],
  ["@fontsource/noto-sans/files/noto-sans-latin-600-normal.woff2", "noto-sans-600.woff2"],
  ["@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2", "noto-sans-700.woff2"],
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-400.woff2"],
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", "jetbrains-mono-700.woff2"],
];
for (const [from, to] of fonts) cpSync(`node_modules/${from}`, `dist/public/fonts/${to}`);
cpSync("src/client/styles.css", "dist/public/app.css");
