import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/fonts', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  external: ['sharp', 'pg', 'ws'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
});

await cp('src/client/index.html', 'dist/public/index.html');
await cp('src/client/styles.css', 'dist/public/styles.css');

const fontDir = 'node_modules/@fontsource-variable/tiktok-sans/files';
for (const file of ['tiktok-sans-latin-wdth-normal.woff2', 'tiktok-sans-latin-ext-wdth-normal.woff2']) {
  await cp(`${fontDir}/${file}`, `dist/public/fonts/${file}`);
}
