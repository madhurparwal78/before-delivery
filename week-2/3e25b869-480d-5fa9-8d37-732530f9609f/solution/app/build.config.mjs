// Bundles the browser client and copies the static assets into dist/public.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist/public', { recursive: true, force: true });
mkdirSync('dist/public/assets', { recursive: true });
await build({
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outfile: 'dist/public/assets/app.js',
  legalComments: 'none',
});
cpSync('src/client/styles.css', 'dist/public/assets/app.css');
cpSync('public/fonts', 'dist/public/fonts', { recursive: true });
