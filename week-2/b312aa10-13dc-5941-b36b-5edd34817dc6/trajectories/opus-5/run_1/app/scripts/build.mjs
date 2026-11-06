import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
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
  minify: true,
  loader: { '.woff2': 'copy' },
  assetNames: 'fonts/[name]',
  logLevel: 'info',
});

await cp('src/public/index.html', 'dist/public/index.html');
