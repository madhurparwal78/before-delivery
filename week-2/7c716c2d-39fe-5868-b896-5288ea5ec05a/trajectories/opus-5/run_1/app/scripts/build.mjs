import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: 'dist/public/app.css',
  bundle: true,
  external: ['/fonts/*'],
  minify: true,
  logLevel: 'info',
});

await cp('public', 'dist/public', { recursive: true });
