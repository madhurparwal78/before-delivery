import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'client/assets'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.js'),
  bundle: true,
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(dist, 'client/assets/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/styles.css')],
  outfile: join(dist, 'client/assets/app.css'),
  bundle: true,
  external: ['/fonts/*'],
  minify: true,
  logLevel: 'info',
});

await cp(join(root, 'public'), join(dist, 'client'), { recursive: true });
await writeFile(
  join(dist, 'client/index.html'),
  await readFile(join(root, 'src/client/index.html'), 'utf8'),
);
