import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const publicDir = resolve(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(publicDir, 'fonts'), { recursive: true });
await mkdir(resolve(dist, 'server'), { recursive: true });

const fonts = [
  ['@fontsource/sora/files/sora-latin-400-normal.woff2', 'sora-400.woff2'],
  ['@fontsource/sora/files/sora-latin-600-normal.woff2', 'sora-600.woff2'],
];
for (const [from, to] of fonts) {
  await copyFile(resolve(root, 'node_modules', from), resolve(publicDir, 'fonts', to));
}

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outfile: resolve(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  outfile: resolve(publicDir, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(root, 'src/client/sw.ts')],
  outfile: resolve(publicDir, 'sw.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(root, 'src/client/styles.css')],
  outfile: resolve(publicDir, 'app.css'),
  bundle: true,
  minify: true,
  // Fonts are served by the app itself, at their published paths.
  external: ['/fonts/*'],
  logLevel: 'warning',
});

console.log('build complete');
