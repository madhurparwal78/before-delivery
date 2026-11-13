// Bundles the client entry point into a single public/app.js.
import { build } from 'esbuild';
import { resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  bundle: true,
  minify: false,
  format: 'iife',
  target: ['es2022'],
  outfile: resolve(root, 'public/app.js'),
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('client built');
