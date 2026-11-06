import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public'), { recursive: true });

// Server: bundle pg as external, everything else in
await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(dist, 'server.js'),
  external: ['pg'],
  sourcemap: false,
  packages: 'external',
  logLevel: 'info',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// Browser app
await build({
  entryPoints: [path.join(root, 'src/browser/app.ts')],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'safari17'],
  format: 'iife',
  outfile: path.join(dist, 'public/assets/app.js'),
  sourcemap: false,
  logLevel: 'info',
  minify: true,
  legalComments: 'none',
});

// CSS
await build({
  entryPoints: [path.join(root, 'src/browser/styles.css')],
  outfile: path.join(dist, 'public/assets/app.css'),
  minify: true,
  logLevel: 'info',
  loader: { '.ttf': 'file' },
});

// Static assets
await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });

// Remove any source maps (defensive)
const mapPath = path.join(dist, 'public/assets/app.css.map');
if (existsSync(mapPath)) await rm(mapPath);

console.log('build complete');
