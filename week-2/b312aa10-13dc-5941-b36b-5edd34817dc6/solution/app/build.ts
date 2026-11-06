// Bundles the server and the browser app into dist/ with esbuild.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/server/main.ts"], outfile: "dist/server.mjs", bundle: true, platform: "node",
  format: "esm", target: "node22", packages: "external", sourcemap: false, logLevel: "warning",
});
await build({
  entryPoints: { app: "src/client/main.tsx", styles: "src/client/styles.css" }, outdir: "dist/client/assets",
  bundle: true, minify: true, format: "esm", target: ["chrome120", "firefox120", "safari17"],
  jsx: "automatic", jsxImportSource: "preact", loader: { ".woff2": "file" }, external: ["/fonts/*"], logLevel: "warning",
});
await mkdir("dist/client/fonts", { recursive: true });
await cp("public/fonts", "dist/client/fonts", { recursive: true, filter: (src) => !src.endsWith(".txt") });
await writeFile("dist/client/index.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lineboard</title>
<link rel="preload" href="/fonts/archivo-black-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body><div id="root"></div></body>
</html>
`);
