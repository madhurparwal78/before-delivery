import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/client.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/styles/site.css'],
  outfile: 'dist/public/site.css',
  bundle: true,
  external: ['/fonts/*'],
  minify: true,
  logLevel: 'info',
});

await cp('public/fonts', 'dist/public/fonts', { recursive: true });
