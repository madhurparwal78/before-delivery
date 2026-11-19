// Build Pegworth Desk: bundle the browser app and the server with esbuild.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  outfile: 'dist/assets/app.js',
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  outfile: 'dist/server.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});

mkdirSync('dist/assets', { recursive: true });
cpSync('public', 'dist/assets', { recursive: true });
console.log('assets:', readdirSync('dist/assets').join(', '));
