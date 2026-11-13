import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const fonts = [
  ['@fontsource/bodoni-moda/files/bodoni-moda-latin-400-normal.woff2', 'bodoni-moda-400.woff2'],
  ['@fontsource/bodoni-moda/files/bodoni-moda-latin-700-normal.woff2', 'bodoni-moda-700.woff2'],
  ['@fontsource/jost/files/jost-latin-400-normal.woff2', 'jost-400.woff2'],
  ['@fontsource/jost/files/jost-latin-500-normal.woff2', 'jost-500.woff2'],
  ['@fontsource/jost/files/jost-latin-600-normal.woff2', 'jost-600.woff2'],
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/fonts', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari16'],
  format: 'iife',
  logLevel: 'info',
});

await cp('src/client/styles.css', 'dist/public/styles.css');

for (const [from, to] of fonts) {
  await cp(`node_modules/${from}`, `dist/public/fonts/${to}`);
}
