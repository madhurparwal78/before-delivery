import { build } from 'esbuild';
import { mkdir, rm, copyFile, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'web', 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/web/main.tsx')],
  outfile: path.join(dist, 'web/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/arimo', 'arimo-latin-400-normal.woff2'],
  ['@fontsource/arimo', 'arimo-latin-700-normal.woff2'],
  ['@fontsource/pt-sans', 'pt-sans-latin-400-normal.woff2'],
  ['@fontsource/pt-sans', 'pt-sans-latin-700-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
];
for (const [pkg, file] of fonts) {
  await copyFile(path.join(root, 'node_modules', pkg, 'files', file), path.join(dist, 'web/fonts', file));
}

for (const name of await readdir(path.join(root, 'src/web/static'))) {
  await copyFile(path.join(root, 'src/web/static', name), path.join(dist, 'web', name));
}

const css = await readFile(path.join(root, 'src/web/styles.css'), 'utf8');
await writeFile(path.join(dist, 'web/app.css'), css);

console.log('build complete');
