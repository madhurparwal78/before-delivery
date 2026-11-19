import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  loader: { '.sql': 'text' },
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/web/main.ts'],
  outfile: 'dist/web/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/web/styles.css'],
  outfile: 'dist/web/app.css',
  bundle: true,
  minify: true,
  external: ['/assets/*'],
  logLevel: 'info',
});

await cp('web/assets', 'dist/web/assets', { recursive: true });
await cp('web/index.html', 'dist/web/index.html');
