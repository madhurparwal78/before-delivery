import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.json"]);
run("npx", ["tsc", "-p", "tsconfig.client.json"]);

mkdirSync("dist/public/fonts", { recursive: true });

await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome120", "firefox120", "safari17"],
  outfile: "dist/public/app.js",
  legalComments: "none",
  sourcemap: false,
});

cpSync("src/client/app.css", "dist/public/app.css");

const fonts = [
  ["@fontsource/archivo", "archivo-latin-400-normal.woff2"],
  ["@fontsource/archivo", "archivo-latin-600-normal.woff2"],
  ["@fontsource/ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2"],
  ["@fontsource/ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2"],
  ["@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"],
  ["@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2"],
];
for (const [pkg, file] of fonts) {
  cpSync(`node_modules/${pkg}/files/${file}`, `dist/public/fonts/${file}`);
}
