import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/assets/app.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/app.css'],
  outfile: 'dist/public/assets/app.css',
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});
