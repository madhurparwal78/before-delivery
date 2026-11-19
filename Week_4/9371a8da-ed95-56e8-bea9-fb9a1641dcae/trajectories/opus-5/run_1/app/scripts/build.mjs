import { build } from 'esbuild';
import { mkdir, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/web/main.tsx'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/newsreader/files/newsreader-latin-400-normal.woff2', 'newsreader-400.woff2'],
  ['@fontsource/newsreader/files/newsreader-latin-600-normal.woff2', 'newsreader-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'plex-mono-600.woff2'],
];
for (const [pkgPath, name] of fonts) {
  await copyFile(require.resolve(pkgPath), `dist/public/fonts/${name}`);
}

await copyFile('src/web/app.css', 'dist/public/app.css');
await copyFile('src/web/index.html', 'dist/public/index.html');
