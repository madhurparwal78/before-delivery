import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const FONTS = [
  ['@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2', 'archivo-black-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'plex-mono-600.woff2'],
];

await rm(dist, { recursive: true, force: true });
await mkdir(join(publicDir, 'assets'), { recursive: true });
await mkdir(join(publicDir, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outdir: join(dist, 'server'),
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(publicDir, 'assets/app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await cp(join(root, 'src/client/app.css'), join(publicDir, 'assets/app.css'));
await cp(join(root, 'src/client/index.html'), join(publicDir, 'index.html'));

for (const [source, target] of FONTS) {
  await cp(join(root, 'node_modules', source), join(publicDir, 'fonts', target));
}
