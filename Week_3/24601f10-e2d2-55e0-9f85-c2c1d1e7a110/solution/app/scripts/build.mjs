import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/fonts', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: ['src/client/main.tsx'],
  outfile: 'dist/public/assets/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  loader: { '.css': 'css' },
  external: ['/fonts/*'],
});

await cp('public/index.html', 'dist/public/index.html');
await cp('public/fonts', 'dist/public/fonts', { recursive: true });
