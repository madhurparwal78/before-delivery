import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'dist', 'public');
const assetsDir = join(outDir, 'assets');
const fontsDir = join(assetsDir, 'fonts');

interface BundledFont {
  package: string;
  file: string;
}

const FONTS: BundledFont[] = [
  { package: '@fontsource/fraunces', file: 'fraunces-latin-400-normal.woff2' },
  { package: '@fontsource/fraunces', file: 'fraunces-latin-600-normal.woff2' },
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans-latin-400-normal.woff2' },
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans-latin-500-normal.woff2' },
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans-latin-600-normal.woff2' },
  { package: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono-latin-400-normal.woff2' },
  { package: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono-latin-500-normal.woff2' },
];

const APP_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cairn</title>
<link rel="stylesheet" href="/assets/app.css" />
<script src="/assets/app.js" defer></script>
</head>
<body>
<div id="cairn-root"></div>
</body>
</html>
`;

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(fontsDir, { recursive: true });

  await build({
    entryPoints: [join(root, 'src', 'client', 'main.tsx')],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    jsx: 'automatic',
    outfile: join(assetsDir, 'app.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });

  await build({
    entryPoints: [join(root, 'src', 'client', 'sw.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    outfile: join(outDir, 'sw.js'),
    logLevel: 'warning',
  });

  await build({
    entryPoints: [join(root, 'src', 'client', 'reader.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    outfile: join(assetsDir, 'reader.js'),
    logLevel: 'warning',
  });

  for (const sheet of ['app.css', 'reader.css']) {
    await build({
      entryPoints: [join(root, 'src', 'client', sheet)],
      bundle: true,
      minify: true,
      external: ['/assets/fonts/*'],
      outfile: join(assetsDir, sheet),
      logLevel: 'warning',
    });
  }

  for (const font of FONTS) {
    await copyFile(join(root, 'node_modules', font.package, 'files', font.file), join(fontsDir, font.file));
  }

  await writeFile(join(outDir, 'index.html'), APP_SHELL, 'utf8');
  const bundled = await readFile(join(assetsDir, 'app.js'), 'utf8');
  process.stdout.write(`built app.js (${Math.round(bundled.length / 1024)} kB) and ${FONTS.length} fonts\n`);
}

await main();
