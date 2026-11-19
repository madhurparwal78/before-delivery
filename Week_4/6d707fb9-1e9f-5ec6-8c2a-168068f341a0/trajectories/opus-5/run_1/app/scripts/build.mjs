import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(out, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(out, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await cp(join(root, 'src/client/styles.css'), join(out, 'public/app.css'));
await mkdir(join(out, 'public/fonts'), { recursive: true });
await cp(join(root, 'src/assets/fonts'), join(out, 'public/fonts'), { recursive: true });
