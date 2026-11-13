import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const ICONS = ['scan-line', 'package', 'handshake', 'triangle-alert'];

await rm(dist, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

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

await cp(join(root, 'public/fonts'), join(publicDir, 'fonts'), { recursive: true });

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
