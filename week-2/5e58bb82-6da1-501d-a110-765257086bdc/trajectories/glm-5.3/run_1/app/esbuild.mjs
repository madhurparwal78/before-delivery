import { build } from 'esbuild';
import { mkdirSync, cpSync, readdirSync } from 'node:fs';

mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/public', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });

const server = build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outdir: 'dist/server',
  outbase: 'src/server',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});

const browser = build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  outdir: 'dist/public',
  entryNames: 'app',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});

await Promise.all([server, browser]);
console.log('build done');
