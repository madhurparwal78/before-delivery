// Bundles the server and the screens with esbuild; tsc has already type-checked both in strict mode.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });

await build({
  entryPoints: ["src/server/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public/assets",
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  jsx: "automatic",
  jsxImportSource: "preact",
  minify: true,
  external: ["/fonts/*"],
  logLevel: "warning",
});

await cp("fonts", "dist/public/fonts", { recursive: true });
await writeFile("dist/public/index.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0a1120">
<title>Lanternline Handshake Desk</title>
<link rel="preload" href="/fonts/space-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`);
