// Build the client bundle into public/app.js.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('public/app.js', { force: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/app.js',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
