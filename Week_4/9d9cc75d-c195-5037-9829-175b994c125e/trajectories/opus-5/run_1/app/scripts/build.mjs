import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public', 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: path.join(dist, 'server', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});

await build({
  entryPoints: [path.join(root, 'client', 'main.ts')],
  outfile: path.join(dist, 'public', 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
});

await build({
  entryPoints: [path.join(root, 'client', 'styles.css')],
  outfile: path.join(dist, 'public', 'app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
});

const fonts = [
  ['@fontsource/quicksand/files/quicksand-latin-300-normal.woff2', 'stack-sans-headline-300.woff2'],
  ['@fontsource/quicksand/files/quicksand-latin-500-normal.woff2', 'stack-sans-headline-500.woff2'],
  ['@fontsource/quicksand/files/quicksand-latin-700-normal.woff2', 'stack-sans-headline-700.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'stack-sans-text-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'stack-sans-text-600.woff2'],
];
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(dist, 'public', 'fonts', to));
}

await writeFile(path.join(dist, 'public', 'index.html'), await readFile(path.join(root, 'client', 'index.html'), 'utf8'));

console.log('build complete');
