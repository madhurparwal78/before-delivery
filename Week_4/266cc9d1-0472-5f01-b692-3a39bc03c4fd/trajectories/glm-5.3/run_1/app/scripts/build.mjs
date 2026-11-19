import { build } from 'esbuild';
import { mkdirSync, copyFileSync, cpSync } from 'node:fs';
import path from 'node:path';

mkdirSync('dist', { recursive: true });

// Server bundle (single file, node platform).
await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/main.js',
  external: ['pg', 'pg-*'],
  sourcemap: false,
  logLevel: 'info',
});

// Client bundle.
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outfile: 'dist/assets/app.js',
  sourcemap: false,
  logLevel: 'info',
  minify: false,
});

// Fonts, styles, shell.
mkdirSync('dist/assets', { recursive: true });
cpSync('src/client/styles', 'dist/assets', { recursive: true });
mkdirSync('dist/assets/fonts', { recursive: true });
cpSync('src/client/styles/fonts', 'dist/assets/fonts', { recursive: true });
copyFileSync('src/client/index.html', 'dist/index.html');
console.log('build complete');
