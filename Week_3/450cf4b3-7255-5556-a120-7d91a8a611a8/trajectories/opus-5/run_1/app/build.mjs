import { build } from 'esbuild';
import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname);
const out = resolve(root, 'dist');

const fonts = [
  ['@fontsource/archivo-narrow/files/archivo-narrow-latin-400-normal.woff2', 'archivo-narrow-400.woff2'],
  ['@fontsource/archivo-narrow/files/archivo-narrow-latin-600-normal.woff2', 'archivo-narrow-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
];

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'public/fonts'), { recursive: true });
await mkdir(resolve(out, 'server'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/main.ts')],
  outfile: resolve(out, 'server/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  outfile: resolve(out, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});

await copyFile(resolve(root, 'src/client/index.html'), resolve(out, 'public/index.html'));
await copyFile(resolve(root, 'src/client/app.css'), resolve(out, 'public/app.css'));
for (const [from, to] of fonts) {
  await copyFile(resolve(root, 'node_modules', from), resolve(out, `public/fonts/${to}`));
}
const html = await readFile(resolve(out, 'public/index.html'), 'utf8');
if (/<style|style="|<script(?![^>]*src=)/i.test(html)) {
  throw new Error('index.html must not contain inline script, style blocks or style attributes');
}