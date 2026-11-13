import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/client',
  entryNames: '[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  minify: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  jsx: 'automatic',
  external: ['/fonts/*'],
  metafile: true,
}).then(async (result) => {
  const names = Object.keys(result.metafile.outputs).map((p) => p.replace('dist/client/', ''));
  const js = names.find((n) => n.endsWith('.js') && n.startsWith('app-'));
  const css = names.find((n) => n.endsWith('.css') && n.startsWith('app-'));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Corbel Draft</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${css ? `<link rel="stylesheet" href="/${css}">` : ''}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${js}"></script>
</body>
</html>
`;
  await writeFile('dist/client/index.html', html);
});

await cp('public', 'dist/client', { recursive: true });
