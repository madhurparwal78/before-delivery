import { build } from 'esbuild';
import { mkdirSync, cpSync } from 'node:fs';

mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/public/assets', { recursive: true });

// Browser bundle (single-page app) served from dist/public/assets
await build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  outfile: 'dist/public/assets/app.js',
  sourcemap: false,
});

// Server bundle (CommonJS for node)
await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  outfile: 'dist/server/main.js',
  external: ['pg'],
  sourcemap: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

// Static shell, styles and fonts are served alongside the bundle.
cpSync('public', 'dist/public', { recursive: true });

console.log('build complete');
