import { build } from "esbuild";
import { writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
mkdirSync("dist/assets", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/server.js",
  packages: "external",
  loader: { ".ts": "ts" },
  sourcemap: false,
});

await build({
  entryPoints: ["src/client/app.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  outfile: "dist/assets/app.js",
  sourcemap: false,
  minify: true,
});

// Jost faces from the app's own files, never another host.
const fontDir = "node_modules/@fontsource/jost";
const files = readdirSync(fontDir).filter((f) => /^(400|500|600)\.css$/.test(f));
let css = "";
for (const f of files) {
  css += `@font-face { font-family: "Jost"; font-style: normal; font-weight: ${f.slice(0, 3)}; font-display: swap; src: url("/assets/jost-${f.slice(0, 3)}.woff2") format("woff2"); }\n`;
}
for (const w of ["400", "500", "600"]) {
  copyFileSync(`${fontDir}/files/jost-latin-${w}-normal.woff2`, `dist/assets/jost-${w}.woff2`);
}
writeFileSync("dist/assets/fonts.css", css);
copyFileSync("src/client/app.css", "dist/assets/app.css");
console.log("built");
