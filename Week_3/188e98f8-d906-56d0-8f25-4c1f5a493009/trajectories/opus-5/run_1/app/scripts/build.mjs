import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicOut = join(dist, 'public');
const assets = join(publicOut, 'assets');
const fonts = join(assets, 'fonts');

await rm(dist, { recursive: true, force: true });
await mkdir(fonts, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg'],
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(assets, 'app.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  logLevel: 'info',
});

await cp(join(root, 'public/index.html'), join(publicOut, 'index.html'));
await cp(join(root, 'public/styles.css'), join(assets, 'styles.css'));

const fontFiles = [
  ['@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', 'fraunces-wght.woff2'],
  ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-400.woff2'],
  ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2', 'atkinson-700.woff2'],
];
for (const [from, to] of fontFiles) {
  await cp(join(root, 'node_modules', from), join(fonts, to));
}
