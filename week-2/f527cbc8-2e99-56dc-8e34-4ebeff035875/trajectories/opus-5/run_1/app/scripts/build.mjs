import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outfile: resolve(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
  banner: {
    js: "import { createRequire as __cl_cr } from 'node:module';const require=__cl_cr(import.meta.url);",
  },
});

await build({
  entryPoints: [resolve(root, 'src/web/main.ts')],
  outfile: resolve(dist, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
});

await mkdir(resolve(dist, 'public/fonts'), { recursive: true });
await cp(resolve(root, 'src/web/index.html'), resolve(dist, 'public/index.html'));
await cp(resolve(root, 'src/web/styles.css'), resolve(dist, 'public/styles.css'));

const fonts = [
  ['@fontsource/archivo/files/archivo-latin-400-normal.woff2', 'archivo-400.woff2'],
  ['@fontsource/archivo/files/archivo-latin-600-normal.woff2', 'archivo-600.woff2'],
  ['@fontsource/archivo/files/archivo-latin-700-normal.woff2', 'archivo-700.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-400-normal.woff2', 'public-sans-400.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-600-normal.woff2', 'public-sans-600.woff2'],
];
for (const [from, to] of fonts) {
  await cp(resolve(root, 'node_modules', from), resolve(dist, 'public/fonts', to));
}

// Migrations and seed assets travel with the build.
await cp(resolve(root, 'src/server/migrations'), resolve(dist, 'server/migrations'), { recursive: true });
await cp(resolve(root, 'src/server/assets'), resolve(dist, 'server/assets'), { recursive: true });

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await mkdir(dirname(resolve(dist, 'server/build-info.json')), { recursive: true });
await writeFile(
  resolve(dist, 'server/build-info.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version }),
);

console.log('build complete');
