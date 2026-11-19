import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

/** Self-hosted font files copied out of their OFL-1.1 packages. */
const fonts = [
  ['@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', 'instrument-serif-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', 'ibm-plex-sans-500.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'client/fonts'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/main.ts')],
  outfile: resolve(dist, 'server/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  outfile: resolve(dist, 'client/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await cp(resolve(root, 'src/client/app.css'), resolve(dist, 'client/app.css'));
await cp(resolve(root, 'src/client/index.html'), resolve(dist, 'client/index.html'));

for (const [from, to] of fonts) {
  await cp(resolve(root, 'node_modules', from), resolve(dist, 'client/fonts', to));
}
