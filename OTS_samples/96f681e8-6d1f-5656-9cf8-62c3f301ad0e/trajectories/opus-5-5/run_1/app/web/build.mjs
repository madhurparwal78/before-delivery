import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const assets = join(dist, "assets");
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(assets, "fonts"), { recursive: true });

await build({
  entryPoints: [join(here, "src", "main.tsx")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  outfile: join(assets, "app.js"),
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  external: ["/assets/fonts/*"],
});

const fonts = [
  ["@fontsource/manrope/files", "manrope-latin-400-normal.woff2"],
  ["@fontsource/manrope/files", "manrope-latin-600-normal.woff2"],
  ["@fontsource/manrope/files", "manrope-latin-700-normal.woff2"],
  ["@fontsource/manrope/files", "manrope-latin-800-normal.woff2"],
  ["@fontsource/plus-jakarta-sans/files", "plus-jakarta-sans-latin-800-normal.woff2"],
  ["@fontsource/plus-jakarta-sans/files", "plus-jakarta-sans-latin-800-italic.woff2"],
];
for (const [dir, file] of fonts) {
  cpSync(join(here, "..", "node_modules", dir, file), join(assets, "fonts", file));
}

writeFileSync(
  join(dist, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yardline · Marlowe Yard Padel Club</title>
<link rel="preload" href="/assets/fonts/manrope-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/plus-jakarta-sans-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`,
);
