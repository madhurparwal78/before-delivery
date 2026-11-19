import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(__dirname, '..');
const dist = join(root, 'dist');

const SHELF_SOURCES: { id: string; file: string; from: string }[] = [
  { id: 'dayjs@1.11.13', file: 'dayjs.min.js', from: 'dayjs/dayjs.min.js' },
  { id: 'lodash@4.17.21', file: 'lodash.min.js', from: 'lodash/lodash.min.js' },
  { id: 'matter-js@0.20.0', file: 'matter.min.js', from: 'matter-js/build/matter.min.js' },
  { id: 'tinycolor2@1.6.0', file: 'tinycolor.js', from: 'tinycolor2/tinycolor.js' },
  { id: 'canvas-confetti@1.9.3', file: 'confetti.js', from: 'canvas-confetti/dist/confetti.browser.js' },
];

const FONTS: string[] = [
  '@fontsource/work-sans/files/work-sans-latin-200-normal.woff2',
  '@fontsource/work-sans/files/work-sans-latin-300-normal.woff2',
  '@fontsource/work-sans/files/work-sans-latin-400-normal.woff2',
  '@fontsource/work-sans/files/work-sans-latin-500-normal.woff2',
  '@fontsource/work-sans/files/work-sans-latin-600-normal.woff2',
  '@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2',
];

const copy = (from: string, to: string): void => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
};

const main = async (): Promise<void> => {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  await build({
    entryPoints: [join(root, 'src/preview/runtime.ts')],
    outfile: join(dist, 'preview-runtime.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });

  await build({
    entryPoints: [join(root, 'src/client/main.ts')],
    outfile: join(dist, 'public/app.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });

  copy(join(root, 'src/client/app.css'), join(dist, 'public/app.css'));

  await build({
    entryPoints: [join(root, 'src/server/index.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    packages: 'external',
    logLevel: 'warning',
  });

  for (const entry of SHELF_SOURCES) {
    copy(join(root, 'node_modules', entry.from), join(dist, 'shelf', entry.id, entry.file));
  }
  for (const font of FONTS) {
    copy(join(root, 'node_modules', font), join(dist, 'public/fonts', font.split('/').pop()!));
  }
};

void main();
