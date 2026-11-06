import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const FONT_FILES = [
  ['@fontsource/archivo', 'archivo-latin-500-normal.woff2'],
  ['@fontsource/archivo', 'archivo-latin-700-normal.woff2'],
  ['@fontsource/inter', 'inter-latin-400-normal.woff2'],
  ['@fontsource/inter', 'inter-latin-600-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2'],
];

const ICONS = [
  'calendar-days',
  'chevron-left',
  'chevron-right',
  'circle',
  'circle-dot',
  'circle-slash',
  'clock',
  'download',
  'file-text',
  'grip-vertical',
  'image',
  'log-out',
  'mail',
  'moon',
  'plus',
  'receipt',
  'search',
  'settings',
  'sliders-horizontal',
  'store',
  'upload',
  'users',
  'x',
];

async function buildIconSprite() {
  const symbols = [];
  for (const name of ICONS) {
    const file = join(root, 'node_modules/lucide-static/icons', `${name}.svg`);
    const svg = await readFile(file, 'utf8');
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    symbols.push(
      `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner.trim()}</symbol>`,
    );
  }
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
  await writeFile(join(publicDir, 'icons.svg'), sprite, 'utf8');
}

async function copyFonts() {
  const target = join(publicDir, 'fonts');
  await mkdir(target, { recursive: true });
  for (const [pkg, file] of FONT_FILES) {
    await cp(join(root, 'node_modules', pkg, 'files', file), join(target, file));
  }
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });

  await esbuild.build({
    entryPoints: [join(root, 'src/server/index.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
    sourcemap: false,
    logLevel: 'info',
  });

  await esbuild.build({
    entryPoints: [join(root, 'src/client/main.ts')],
    outfile: join(publicDir, 'app.js'),
    bundle: true,
    platform: 'browser',
    target: ['chrome120', 'firefox120', 'safari17'],
    format: 'esm',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
  });

  await esbuild.build({
    entryPoints: [join(root, 'src/styles/app.css')],
    outfile: join(publicDir, 'app.css'),
    bundle: true,
    minify: true,
    external: ['/assets/*'],
    logLevel: 'info',
  });

  await copyFonts();
  await buildIconSprite();

  const files = await readdir(publicDir);
  console.log(`public: ${files.join(', ')}`);
}

await main();
