import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('public', { recursive: true });
const result = await build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'public/app.js',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});
if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}
console.log('browser bundle written to public/app.js');
