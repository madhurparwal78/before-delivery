import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const publicAssets = join(dist, 'public', 'assets');

const FONT_FILES = [
  ['@fontsource/fredoka/files/fredoka-latin-400-normal.woff2', 'fredoka-400.woff2'],
  ['@fontsource/fredoka/files/fredoka-latin-600-normal.woff2', 'fredoka-600.woff2'],
  ['@fontsource/nunito/files/nunito-latin-400-normal.woff2', 'nunito-400.woff2'],
  ['@fontsource/nunito/files/nunito-latin-700-normal.woff2', 'nunito-700.woff2'],
  ['@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2', 'noto-sans-jp-400.woff2'],
  ['@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2', 'noto-sans-jp-700.woff2'],
];

const ICONS = [
  'home',
  'pencil',
  'hammer',
  'swords',
  'box',
  'book-open',
  'users',
  'undo-2',
  'redo-2',
  'save',
  'trash-2',
  'upload',
  'send',
  'message-circle',
  'smile',
  'x',
];

await rm(dist, { recursive: true, force: true });
await mkdir(publicAssets, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.mjs'),
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
  outfile: join(publicAssets, 'app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await cp(join(root, 'src/client/app.css'), join(publicAssets, 'app.css'));

await mkdir(join(publicAssets, 'fonts'), { recursive: true });
for (const [source, target] of FONT_FILES) {
  await cp(join(root, 'node_modules', source), join(publicAssets, 'fonts', target));
}

const iconSprite = [];
for (const name of ICONS) {
  const svg = await readFile(join(root, 'node_modules/lucide-static/icons', `${name}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  iconSprite.push(`<symbol id="icon-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}
await mkdir(dirname(join(publicAssets, 'icons.svg')), { recursive: true });
await writeFile(
  join(publicAssets, 'icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${iconSprite.join('')}</svg>`,
  'utf8',
);

console.log('build complete');
