// Builds the server bundle and the browser bundle into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/client", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  outfile: "dist/server/main.js",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  bundle: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  minify: true,
  external: ["/fonts/*"],
  outdir: "dist/client",
  logLevel: "warning",
});

cpSync("public/fonts", "dist/client/fonts", { recursive: true });
writeFileSync(
  "dist/client/index.html",
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pegworth Desk</title>
<link rel="preload" href="/fonts/archivo-black-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/app.js"></script>
</head>
<body><div id="root"></div></body>
</html>
`,
);
