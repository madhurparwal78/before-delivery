// Build: compile the server to CommonJS and bundle the client with esbuild.

import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "server"), { recursive: true });
fs.mkdirSync(path.join(dist, "public"), { recursive: true });

// 1. Server: tsc emits CJS.
execSync("npx tsc -p tsconfig.server.json", { stdio: "inherit" });

// 2. Client bundle: one JS file, one CSS file, three.js included, no remote asset.
await build({
  entryPoints: [path.join(root, "src/client/main.ts")],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  target: "es2022",
  outfile: path.join(dist, "public", "bundle.js"),
  loader: { ".woff2": "file" },
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info"
});

// 3. Copy static public assets (fonts, css, images).
fs.cpSync(path.join(root, "public"), path.join(dist, "public"), { recursive: true });

// 4. Copy the Albert Sans woff2 files we bundle.
const fontDir = path.join(root, "node_modules/@fontsource/albert-sans/files");
const targetFonts = path.join(dist, "public", "fonts");
fs.mkdirSync(targetFonts, { recursive: true });
for (const file of ["albert-sans-latin-400-normal.woff2", "albert-sans-latin-500-normal.woff2", "albert-sans-latin-700-normal.woff2"]) {
  const src = path.join(fontDir, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetFonts, file));
}

// 5. Generate the bundled pictures from the world's own code.
execSync("npx tsc --esModuleInterop --target es2023 --skipLibCheck --module commonjs --moduleResolution node --outDir /tmp/assets-build scripts/assets.mts.ts", { stdio: "inherit" });
execSync("node /tmp/assets-build/assets.mts.js", { stdio: "inherit" });

console.log("build done");
