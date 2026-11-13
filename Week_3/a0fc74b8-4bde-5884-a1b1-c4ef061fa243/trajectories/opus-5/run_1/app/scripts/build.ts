import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const dist = join(root, 'dist');
const assets = join(dist, 'public', 'assets');

const FONT_FILES: ReadonlyArray<[string, string]> = [
  ['@fontsource/fraunces/files/fraunces-latin-400-normal.woff2', 'fraunces-400.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-600-normal.woff2', 'fraunces-600.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-400-normal.woff2', 'public-sans-400.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-600-normal.woff2', 'public-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
];

const PDFJS_FILES: ReadonlyArray<[string, string]> = [
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.mjs'],
];

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Undersign</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`;

const main = async (): Promise<void> => {
  await rm(dist, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await mkdir(join(assets, 'fonts'), { recursive: true });

  await build({
    entryPoints: [join(root, 'src/server/main.ts')],
    outfile: join(dist, 'server/main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'info',
  });

  await build({
    entryPoints: [join(root, 'src/client/main.ts')],
    outfile: join(assets, 'app.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    external: ['/assets/*'],
    logLevel: 'info',
  });

  await build({
    entryPoints: [join(root, 'src/client/app.css')],
    outfile: join(assets, 'app.css'),
    bundle: true,
    minify: true,
    external: ['/assets/*'],
    logLevel: 'info',
  });

  for (const [from, to] of FONT_FILES) {
    await cp(join(root, 'node_modules', from), join(assets, 'fonts', to));
  }
  for (const [from, to] of PDFJS_FILES) {
    await cp(join(root, 'node_modules', from), join(assets, to));
  }
  await writeFile(join(dist, 'public', 'index.html'), INDEX_HTML, 'utf8');
};

await main();
