// Bundles the browser client with esbuild: TypeScript in, one JS file out.
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'public/app.js',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

if (result.errors.length > 0) process.exit(1);
