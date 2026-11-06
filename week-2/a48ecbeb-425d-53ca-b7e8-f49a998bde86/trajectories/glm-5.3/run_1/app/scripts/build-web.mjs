import { build } from 'esbuild';
import { cpSync } from 'node:fs';

await build({
  entryPoints: ['web/app.ts'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022', 'chrome120', 'firefox120', 'safari17'],
  outfile: 'dist/web/assets/app.js',
  legalComments: 'none',
});

cpSync('public', 'dist/public', { recursive: true });

