import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const publicDir = resolve(dist, 'public');
const fontDir = resolve(publicDir, 'fonts');

const FONTS = [
  ['@fontsource/source-serif-4', 'source-serif-4-latin-400-normal.woff2'],
  ['@fontsource/source-serif-4', 'source-serif-4-latin-600-normal.woff2'],
  ['@fontsource/source-serif-4', 'source-serif-4-latin-400-italic.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2'],
];

await rm(dist, { recursive: true, force: true });
await mkdir(fontDir, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server.ts')],
  outfile: resolve(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: [
    resolve(root, 'src/client/editor.ts'),
    resolve(root, 'src/client/reader.ts'),
  ],
  outdir: publicDir,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(root, 'src/styles/app.css')],
  outfile: resolve(publicDir, 'app.css'),
  bundle: true,
  external: ['/static/fonts/*'],
  minify: true,
  logLevel: 'warning',
});

for (const [pkg, file] of FONTS) {
  await cp(resolve(root, 'node_modules', pkg, 'files', file), resolve(fontDir, file));
}

console.log('build complete');
