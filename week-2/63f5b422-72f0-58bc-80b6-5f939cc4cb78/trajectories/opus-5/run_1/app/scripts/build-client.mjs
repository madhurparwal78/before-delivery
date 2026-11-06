import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('public/build', { recursive: true });
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'public/build/client.js',
  sourcemap: false,
  legalComments: 'none',
  minify: false,
});
