// Builds the browser app into /app/dist, which the Go server embeds and serves.

import { build } from 'esbuild';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const dist = join(appRoot, 'dist');

const fonts = [
  ['@fontsource/figtree/files/figtree-latin-400-normal.woff2', 'figtree-400.woff2'],
  ['@fontsource/figtree/files/figtree-latin-600-normal.woff2', 'figtree-600.woff2'],
  ['@fontsource/figtree/files/figtree-latin-700-normal.woff2', 'figtree-700.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
];

const fontFaces = `
@font-face {
  font-family: Figtree;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/figtree-400.woff2') format('woff2');
}
@font-face {
  font-family: Figtree;
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/figtree-600.woff2') format('woff2');
}
@font-face {
  font-family: Figtree;
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/figtree-700.woff2') format('woff2');
}
@font-face {
  font-family: Inter;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/inter-400.woff2') format('woff2');
}
@font-face {
  font-family: Inter;
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/inter-600.woff2') format('woff2');
}
`;

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Interline Desk</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'assets'), { recursive: true });
await mkdir(join(dist, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'assets/app.js'),
  legalComments: 'none',
});

const css = await build({
  entryPoints: [join(here, 'src/styles.css')],
  bundle: true,
  minify: true,
  write: false,
  outfile: join(dist, 'assets/app.css'),
});
await writeFile(join(dist, 'assets/app.css'), fontFaces + css.outputFiles[0].text, 'utf8');

for (const [from, to] of fonts) {
  await copyFile(join(appRoot, 'node_modules', from), join(dist, 'fonts', to));
}

await writeFile(join(dist, 'index.html'), page, 'utf8');
console.log('built dist/');
