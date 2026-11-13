import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const FONT_FILES = [
  ['@fontsource/imbue/files/imbue-latin-400-normal.woff2', 'imbue-400.woff2'],
  ['@fontsource/imbue/files/imbue-latin-600-normal.woff2', 'imbue-600.woff2'],
  ['@fontsource/albert-sans/files/albert-sans-latin-400-normal.woff2', 'albert-sans-400.woff2'],
  ['@fontsource/albert-sans/files/albert-sans-latin-500-normal.woff2', 'albert-sans-500.woff2'],
  ['@fontsource/albert-sans/files/albert-sans-latin-700-normal.woff2', 'albert-sans-700.woff2'],
];

const ICONS = ['scan-line', 'lamp-desk', 'package', 'handshake', 'file-check', 'circle-check', 'triangle-alert'];

await rm(dist, { recursive: true, force: true });
await mkdir(join(publicDir, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outdir: join(dist, 'server'),
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(publicDir, 'app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  bundle: true,
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/sw.ts')],
  outfile: join(publicDir, 'sw.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  bundle: true,
  minify: true,
  logLevel: 'info',
});

await cp(join(root, 'src/client/index.html'), join(publicDir, 'index.html'));
await cp(join(root, 'src/client/styles.css'), join(publicDir, 'styles.css'));

for (const [from, to] of FONT_FILES) {
  await cp(join(root, 'node_modules', from), join(publicDir, 'fonts', to));
}

const sprites = [];
for (const icon of ICONS) {
  const svg = await readFile(join(root, 'node_modules/lucide-static/icons', `${icon}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace('</svg>', '');
  sprites.push(`<symbol id="icon-${icon}" viewBox="0 0 24 24">${inner}</symbol>`);
}
await writeFile(
  join(publicDir, 'icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${sprites.join('')}</svg>`,
  'utf8',
);
