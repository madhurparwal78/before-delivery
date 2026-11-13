import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'public/fonts'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outfile: resolve(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.tsx')],
  outfile: resolve(dist, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari16'],
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/app.css')],
  outfile: resolve(dist, 'public/app.css'),
  bundle: true,
  minify: true,
  logLevel: 'info',
});

await cp(resolve(root, 'public/index.html'), resolve(dist, 'public/index.html'));

const fonts = [
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
  ['@fontsource/inter/files/inter-latin-800-normal.woff2', 'inter-800.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'mono-400.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2', 'mono-700.woff2'],
];
for (const [from, to] of fonts) {
  await cp(resolve(root, 'node_modules', from), resolve(dist, 'public/fonts', to));
}

const css = await readFile(resolve(dist, 'public/app.css'), 'utf8');
await writeFile(resolve(dist, 'public/app.css'), `${fontFaces()}\n${css}`, 'utf8');

function fontFaces() {
  const face = (family, weight, file) =>
    `@font-face{font-family:${family};font-style:normal;font-weight:${weight};font-display:swap;src:url(/fonts/${file}) format("woff2")}`;
  return [
    face('Inter', 400, 'inter-400.woff2'),
    face('Inter', 600, 'inter-600.woff2'),
    face('Inter', 800, 'inter-800.woff2'),
    face('"JetBrains Mono"', 400, 'mono-400.woff2'),
    face('"JetBrains Mono"', 700, 'mono-700.woff2'),
  ].join('');
}
