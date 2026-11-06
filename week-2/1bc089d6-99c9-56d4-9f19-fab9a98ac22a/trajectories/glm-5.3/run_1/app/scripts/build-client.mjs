// Bundles the browser code to public/app.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2021'],
  outfile: 'public/app.js',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

console.log('client bundled');
