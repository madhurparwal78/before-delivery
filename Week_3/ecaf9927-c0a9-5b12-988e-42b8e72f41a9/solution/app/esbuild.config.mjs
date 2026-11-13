import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});

{
  const client = await build({
    entryPoints: ['src/client/main.tsx'],
    outdir: 'dist/client',
    entryNames: '[name]-[hash]',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['chrome110', 'firefox110', 'safari16'],
    minify: true,
    sourcemap: false,
    metafile: true,
    loader: { '.woff2': 'file' },
    assetNames: 'fonts/[name]-[hash]',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const outputs = Object.keys(client.metafile.outputs);
  const script = outputs.find((f) => f.endsWith('.js'))?.replace('dist/client/', '');
  const style = outputs.find((f) => f.endsWith('.css'))?.replace('dist/client/', '');
  await writeFile(
    'dist/client/index.html',
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kerfline Bench</title>
${style ? `<link rel="stylesheet" href="/${style}">` : ''}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${script}"></script>
</body>
</html>
`,
  );
}
