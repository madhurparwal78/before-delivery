import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });
cpSync('public', 'dist', { recursive: true });

await build({
  entryPoints: ['src/server/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  external: ['pg', 'pg-protocol', 'pg-types', 'pg-connection-string', 'pg-pool', 'pgpass'],
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/assets/app.js',
  sourcemap: false,
  logLevel: 'warning',
  minify: true,
  legalComments: 'none',
});

console.log('built server and client');
