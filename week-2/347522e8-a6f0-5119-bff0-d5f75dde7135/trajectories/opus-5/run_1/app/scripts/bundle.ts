/**
 * Build step for the browser side: bundles the client, copies the shell, the
 * stylesheet, the bundled fonts and an icon sprite built from Lucide. Every
 * asset the browser loads therefore comes from the app's own origin.
 */

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const clientRoot = join(projectRoot, 'src', 'client');
const outputRoot = join(projectRoot, 'dist', 'public');
const assetRoot = join(outputRoot, 'assets');
const fontRoot = join(assetRoot, 'fonts');

/** The Lucide icons the screens use. */
const ICONS = [
  'menu',
  'x',
  'check',
  'triangle-alert',
  'copy',
  'upload',
  'download',
  'chevron-left',
  'chevron-right',
  'calendar-days',
  'clock',
  'wrench',
  'log-out',
  'file-text',
];

/** One weight of each bundled family, which is all the type scale needs. */
const FONTS = [
  { package: '@fontsource/archivo-black', file: 'archivo-black-latin-400-normal.woff2' },
  { package: '@fontsource/public-sans', file: 'public-sans-latin-400-normal.woff2' },
  { package: '@fontsource/public-sans', file: 'public-sans-latin-600-normal.woff2' },
  { package: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2' },
  { package: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-700-normal.woff2' },
];

async function bundleClient(): Promise<void> {
  await build({
    entryPoints: [join(clientRoot, 'main.ts')],
    bundle: true,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    outfile: join(assetRoot, 'app.js'),
  });
  await build({
    entryPoints: [join(clientRoot, 'app.css')],
    bundle: true,
    minify: true,
    // The font files are copied beside the stylesheet, so their URLs stay as written.
    external: ['/assets/*'],
    outfile: join(assetRoot, 'app.css'),
  });
}

async function copyFonts(): Promise<void> {
  await mkdir(fontRoot, { recursive: true });
  for (const font of FONTS) {
    const source = join(projectRoot, 'node_modules', font.package, 'files', font.file);
    await copyFile(source, join(fontRoot, font.file));
  }
}

/** Builds one sprite so the browser fetches the icon set once, from this origin. */
async function buildIconSprite(): Promise<void> {
  const iconRoot = join(projectRoot, 'node_modules', 'lucide-static', 'icons');
  const available = new Set(await readdir(iconRoot));
  const symbols: string[] = [];
  for (const name of ICONS) {
    const file = `${name}.svg`;
    if (!available.has(file)) throw new Error(`lucide icon ${name} is not in lucide-static`);
    const svg = await readFile(join(iconRoot, file), 'utf8');
    const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1]?.trim();
    if (inner === undefined) throw new Error(`cannot read lucide icon ${name}`);
    symbols.push(`<symbol id="icon-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
  }
  await writeFile(
    join(assetRoot, 'icons.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>`,
    'utf8',
  );
}

async function main(): Promise<void> {
  await mkdir(assetRoot, { recursive: true });
  await bundleClient();
  await copyFonts();
  await buildIconSprite();
  await mkdir(dirname(join(outputRoot, 'index.html')), { recursive: true });
  await copyFile(join(clientRoot, 'index.html'), join(outputRoot, 'index.html'));
  process.stdout.write('browser assets built\n');
}

await main();
