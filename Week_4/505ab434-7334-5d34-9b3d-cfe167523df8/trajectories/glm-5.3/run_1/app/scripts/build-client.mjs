import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });

await build({
  entryPoints: ['src/ui/client.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'public/app.js',
  legalComments: 'none',
  logLevel: 'info',
});
