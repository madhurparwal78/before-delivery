import { build } from 'esbuild';
import { mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

await rm(root + 'dist', { recursive: true, force: true });
await mkdir(root + 'dist/public/assets', { recursive: true });

await build({
  entryPoints: [root + 'src/server/index.ts'],
  outfile: root + 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
});

await build({
  entryPoints: [root + 'src/client/main.ts'],
  outfile: root + 'dist/public/assets/main.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  minify: true,
  sourcemap: false,
});

await build({
  entryPoints: [root + 'src/client/styles.css'],
  outfile: root + 'dist/public/assets/styles.css',
  bundle: true,
  external: ['/assets/*'],
  minify: true,
});

const fonts = [
  ['node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2', 'dist/public/assets/bebas-neue-400.woff2'],
  ['node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2', 'dist/public/assets/eb-garamond-400.woff2'],
  ['node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2', 'dist/public/assets/eb-garamond-400-italic.woff2'],
  ['node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2', 'dist/public/assets/eb-garamond-600.woff2'],
];
for (const [from, to] of fonts) {
  await mkdir(dirname(root + to), { recursive: true });
  await copyFile(root + from, root + to);
}

const icons = [
  ['node_modules/@phosphor-icons/core/assets/regular/magnifying-glass.svg', 'dist/public/assets/icon-magnifying-glass.svg'],
  ['node_modules/@phosphor-icons/core/assets/regular/play.svg', 'dist/public/assets/icon-play.svg'],
  ['node_modules/@phosphor-icons/core/assets/regular/pause.svg', 'dist/public/assets/icon-pause.svg'],
  ['node_modules/@phosphor-icons/core/assets/regular/list.svg', 'dist/public/assets/icon-list.svg'],
  ['node_modules/@phosphor-icons/core/assets/regular/download-simple.svg', 'dist/public/assets/icon-download.svg'],
];
for (const [from, to] of icons) await copyFile(root + from, root + to);

await copyFile(root + 'src/client/index.html', root + 'dist/public/index.html');

await mkdir(root + 'dist/server/print-assets', { recursive: true });
for (const [from, to] of [
  ['node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2', 'dist/server/print-assets/bebas-neue.woff2'],
  ['node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2', 'dist/server/print-assets/eb-garamond.woff2'],
]) {
  await copyFile(root + from, root + to);
}

await writeFile(root + 'dist/server/schema.sql', await readFile(root + 'src/server/db/schema.sql', 'utf8'));

console.log('build complete');
