// Build configuration: bundles the TypeScript server, client and service worker.
import { build } from 'esbuild';

const shared = { bundle: true, logLevel: 'info', target: 'es2022' };

await build({
  ...shared,
  entryPoints: ['src/server/index.ts'],
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'dist/server.js',
});

await build({
  ...shared,
  entryPoints: ['src/web/main.ts'],
  platform: 'browser',
  format: 'iife',
  minify: true,
  outfile: 'public/app.js',
});

await build({
  ...shared,
  entryPoints: ['src/web/sw.ts'],
  platform: 'browser',
  format: 'iife',
  minify: true,
  outfile: 'public/sw.js',
});

await build({
  ...shared,
  entryPoints: ['src/web/styles/app.css'],
  minify: true,
  external: ['/fonts/*'],
  outfile: 'public/app.css',
});
