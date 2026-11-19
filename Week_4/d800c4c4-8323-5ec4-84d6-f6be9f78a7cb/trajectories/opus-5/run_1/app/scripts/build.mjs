import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const publicDir = path.join(dist, 'public');

const FONT_FILES = [
  ['@fontsource/archivo-black', 'archivo-black-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2'],
];

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pegworth Desk</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(publicDir, 'assets', 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/main.tsx')],
  outfile: path.join(publicDir, 'assets/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/styles/app.css')],
  outfile: path.join(publicDir, 'assets/app.css'),
  bundle: true,
  minify: true,
  external: ['/assets/fonts/*'],
  logLevel: 'info',
});

for (const [pkg, file] of FONT_FILES) {
  const from = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file);
  await cp(from, path.join(publicDir, 'assets/fonts', file));
}

await writeFile(path.join(publicDir, 'index.html'), INDEX_HTML, 'utf8');
