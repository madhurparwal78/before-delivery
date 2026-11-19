import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outdir: 'dist/server',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  bundle: true,
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: 'dist/public/app.css',
  bundle: true,
  loader: { '.woff2': 'file' },
  minify: true,
  logLevel: 'info',
});

await cp('public', 'dist/public', { recursive: true });
