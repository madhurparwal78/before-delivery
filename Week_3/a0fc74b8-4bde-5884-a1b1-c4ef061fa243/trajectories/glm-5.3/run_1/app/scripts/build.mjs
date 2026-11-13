import { build } from "esbuild";
import { mkdirSync, cpSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "dist");
mkdirSync(out, { recursive: true });

// Server bundle
await build({
  entryPoints: { server: join(root, "src/server/main.ts") },
  outdir: out,
  outbase: join(root, "src/server"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  external: [],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
console.log("server bundled");

// Browser bundle
const browserOut = join(out, "public");
mkdirSync(browserOut, { recursive: true });
await build({
  entryPoints: { "app": join(root, "src/browser/app.ts") },
  external: ["/fonts/*"],
  outdir: browserOut,
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  sourcemap: false,
  minify: true,
  logLevel: "warning",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  assetNames: "[name]",
});
console.log("browser bundled");

// pdfjs worker copied next to the bundle
const pdfjs = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
cpSync(pdfjs, join(browserOut, "pdf.worker.min.mjs"));

// Fonts: copy only the needed weights of each family
const pub = join(root, "public");
if (existsSync(pub)) {
  cpSync(pub, browserOut, { recursive: true });
}
const fontPairs = [
  ["@fontsource/fraunces", "fraunces"],
  ["@fontsource/public-sans", "public-sans"],
  ["@fontsource/ibm-plex-mono", "ibm-plex-mono"],
];
const fontsDir = join(browserOut, "fonts");
mkdirSync(fontsDir, { recursive: true });
for (const [pkg, fam] of fontPairs) {
  const filesDir = join(root, "node_modules", pkg, "files");
  if (!existsSync(filesDir)) continue;
  const weights = ["400", "500", "600", "700"];
  for (const w of weights) {
    const name = `${fam}-latin-${w}-normal.woff2`;
    if (existsSync(join(filesDir, name))) cpSync(join(filesDir, name), join(fontsDir, name));
  }
}
console.log("assets copied");
