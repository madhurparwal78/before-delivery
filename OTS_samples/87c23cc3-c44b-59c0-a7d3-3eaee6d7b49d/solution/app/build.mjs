import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'

const dist = process.env.JOINERY_DIST ?? 'dist'
await rm(dist, { recursive: true, force: true })
await mkdir(`${dist}/public/assets`, { recursive: true })

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: `${dist}/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
})

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: `${dist}/public/assets`,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['/fonts/*'],
})

await cp('fonts', `${dist}/public/fonts`, { recursive: true })

const icon = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1f6fe5"/><path d="M8 22V10h5a4 4 0 0 1 0 8H8" fill="none" stroke="#fff" stroke-width="3"/></svg>',
)
await writeFile(
  `${dist}/public/index.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Joinery</title>
<link rel="icon" href="data:image/svg+xml,${icon}">
<link rel="preload" href="/fonts/noto-sans-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/noto-sans-latin-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/noto-sans-latin-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="application/json" id="boot">__BOOT__</script>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`,
)
