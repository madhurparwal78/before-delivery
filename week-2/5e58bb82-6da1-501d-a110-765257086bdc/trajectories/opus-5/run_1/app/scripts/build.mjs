import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const FONT_FILES = [
  ['newsreader', 'newsreader-latin-400-normal.woff2'],
  ['newsreader', 'newsreader-latin-600-normal.woff2'],
  ['newsreader', 'newsreader-latin-700-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-700-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2'],
  ['ibm-plex-mono', 'ibm-plex-mono-latin-700-normal.woff2'],
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'public/fonts'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outdir: resolve(dist, 'server'),
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  minify: false,
  packages: 'external',
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  outfile: resolve(dist, 'public/app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  bundle: true,
  sourcemap: false,
  minify: true,
  logLevel: 'warning',
});

for (const [pkg, file] of FONT_FILES) {
  await cp(
    resolve(root, 'node_modules/@fontsource', pkg, 'files', file),
    resolve(dist, 'public/fonts', file),
  );
}

await cp(resolve(root, 'src/client/app.css'), resolve(dist, 'public/app.css'));
await cp(resolve(root, 'src/client/index.html'), resolve(dist, 'public/index.html'));
await cp(resolve(root, 'src/server/schema.sql'), resolve(dist, 'server/schema.sql'));

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(
  resolve(dist, 'server/build-info.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version }),
);

console.log('build complete');
