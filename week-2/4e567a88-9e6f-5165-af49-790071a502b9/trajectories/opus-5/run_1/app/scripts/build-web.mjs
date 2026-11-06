import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist/public');

const fonts = [
  ['@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2', 'bricolage-grotesque-500.woff2'],
  ['@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2', 'bricolage-grotesque-700.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'fonts'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/web/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  outfile: resolve(out, 'app.js'),
  logLevel: 'info',
});

await cp(resolve(root, 'src/web/index.html'), resolve(out, 'index.html'));
await cp(resolve(root, 'src/web/styles.css'), resolve(out, 'styles.css'));

for (const [from, to] of fonts) {
  const src = resolve(root, 'node_modules', from);
  const dest = resolve(out, 'fonts', to);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
}

const favicon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVR4nGP8z8DAwMDAxIAGRhkHFxcDAwMDEwMaGGUcXFwMDAwMTAxoYJRxcHExMDAwMDGggVHGwcXFwMAAAI0cB4ZJ4C0zAAAAAElFTkSuQmCC',
  'base64',
);
await writeFile(resolve(out, 'favicon.png'), favicon);

const html = await readFile(resolve(out, 'index.html'), 'utf8');
if (!html.includes('app.js')) throw new Error('index.html does not load app.js');
console.log('web build complete');
