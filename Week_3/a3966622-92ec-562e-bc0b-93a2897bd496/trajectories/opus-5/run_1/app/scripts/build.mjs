import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
const path = (url) => fileURLToPath(url);

const fonts = [
  ['@fontsource/saira-condensed/files/saira-condensed-latin-500-normal.woff2', 'saira-condensed-500.woff2'],
  ['@fontsource/saira-condensed/files/saira-condensed-latin-600-normal.woff2', 'saira-condensed-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];

await rm(out, { recursive: true, force: true });
await mkdir(new URL('web/assets/fonts/', out), { recursive: true });

await build({
  entryPoints: [path(new URL('src/server/index.ts', root))],
  outfile: path(new URL('server/index.js', out)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: [path(new URL('src/web/main.tsx', root))],
  outfile: path(new URL('web/assets/app.js', out)),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

for (const [from, to] of fonts) {
  await cp(new URL(`node_modules/${from}`, root), new URL(`web/assets/fonts/${to}`, out));
}
await cp(new URL('src/web/index.html', root), new URL('web/index.html', out));
await cp(new URL('src/web/styles.css', root), new URL('web/assets/styles.css', out));
