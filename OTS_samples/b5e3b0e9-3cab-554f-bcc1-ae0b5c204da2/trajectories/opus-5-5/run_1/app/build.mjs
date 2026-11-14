import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
});

await build({
  entryPoints: { app: 'client/main.tsx' },
  outdir: 'dist/public/assets',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]',
});

cpSync('client/index.html', 'dist/public/index.html');
