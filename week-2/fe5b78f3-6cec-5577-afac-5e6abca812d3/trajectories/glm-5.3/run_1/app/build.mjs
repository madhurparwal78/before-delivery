// Build: bundle the server to dist/server.js (ESM), copy the fonts, and
// compile the client bundle into public/app.js.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(root, 'dist/server.js'),
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: join(root, 'public/app.js'),
  sourcemap: false,
  legalComments: 'none',
  minify: false,
});

cpSync(join(root, 'fonts'), join(root, 'public/fonts'), { recursive: true });
console.log('built');
