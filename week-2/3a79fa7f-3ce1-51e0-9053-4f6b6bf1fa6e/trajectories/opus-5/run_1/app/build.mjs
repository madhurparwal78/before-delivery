import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: 'dist/public/app.css',
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

cpSync('public', 'dist/public', { recursive: true });
