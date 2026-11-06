import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/server.js',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/web/main.ts'],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  outfile: 'dist/public/app.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await cp('src/web/app.css', 'dist/public/app.css');
await cp('public/fonts', 'dist/public/fonts', { recursive: true });
