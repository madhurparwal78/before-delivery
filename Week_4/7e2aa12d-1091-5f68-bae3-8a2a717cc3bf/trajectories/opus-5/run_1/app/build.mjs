import { build } from 'esbuild';
import { mkdir, cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/client/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await cp('src/client/styles.css', 'dist/client/styles.css');
