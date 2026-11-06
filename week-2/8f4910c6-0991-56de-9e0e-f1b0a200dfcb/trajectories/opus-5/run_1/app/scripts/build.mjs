import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'public'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(dist, 'server/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg', '@napi-rs/canvas'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/server/services/imageWorker.ts')],
  outfile: join(dist, 'server/image-worker.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@napi-rs/canvas'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(dist, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await cp(join(root, 'public'), join(dist, 'public'), { recursive: true });
