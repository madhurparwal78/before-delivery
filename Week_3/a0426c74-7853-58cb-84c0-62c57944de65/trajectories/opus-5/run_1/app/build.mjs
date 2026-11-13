import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/index.js',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  outfile: 'dist/public/app.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles.css'],
  bundle: true,
  outfile: 'dist/public/app.css',
  external: ['/fonts/*'],
  minify: true,
  logLevel: 'info',
});

await cp('public', 'dist/public', { recursive: true });
await cp('src/client/index.html', 'dist/public/index.html');
