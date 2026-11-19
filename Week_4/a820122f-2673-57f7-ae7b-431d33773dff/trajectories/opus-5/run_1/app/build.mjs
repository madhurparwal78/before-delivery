import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/static/fonts`, { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: `${out}/server/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: `${out}/static/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/service-worker.ts'],
  outfile: `${out}/static/service-worker.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: `${out}/static/app.css`,
  bundle: true,
  loader: { '.woff2': 'empty' },
  external: ['/static/fonts/*'],
  minify: true,
  logLevel: 'info',
});

await cp('src/client/index.html', `${out}/static/index.html`);

const fonts = [
  ['@fontsource/spectral/files/spectral-latin-400-normal.woff2', 'spectral-400.woff2'],
  ['@fontsource/spectral/files/spectral-latin-400-italic.woff2', 'spectral-400-italic.woff2'],
  ['@fontsource/spectral/files/spectral-latin-600-normal.woff2', 'spectral-600.woff2'],
  ['@fontsource/spectral/files/spectral-latin-600-italic.woff2', 'spectral-600-italic.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', 'plex-500.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-600.woff2'],
];
for (const [from, to] of fonts) {
  await cp(`node_modules/${from}`, `${out}/static/fonts/${to}`);
}

console.log('build complete');
