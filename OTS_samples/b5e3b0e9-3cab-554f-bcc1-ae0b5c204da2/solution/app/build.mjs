import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dirname;
const dist = path.join(root, "dist");

const typecheck = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { stdio: "inherit" });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "public", "assets"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/server/index.ts")],
  outfile: path.join(dist, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
});

await build({
  entryPoints: { app: path.join(root, "src/client/main.tsx") },
  outdir: path.join(dist, "public", "assets"),
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  minify: true,
  sourcemap: false,
  external: ["/assets/*"],
});

await cp(path.join(root, "public", "fonts"), path.join(dist, "public", "assets", "fonts"), { recursive: true });
await writeFile(
  path.join(dist, "public", "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Niner Hall Runup Bay</title>
<link rel="icon" href="data:,">
<link rel="preload" href="/assets/fonts/stack-sans-text-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/stack-sans-text-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/stack-sans-headline-latin-300-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/spline-sans-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`,
);
