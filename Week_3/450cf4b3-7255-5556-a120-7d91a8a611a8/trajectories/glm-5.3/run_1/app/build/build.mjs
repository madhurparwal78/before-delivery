import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Copy the bundled font files into the public assets.
const fontsDir = path.join(root, 'public/assets/fonts');
fs.rmSync(fontsDir, { recursive: true, force: true });
fs.mkdirSync(fontsDir, { recursive: true });
const fontPackages = [
  ['@fontsource/archivo-narrow', ['400', '500', '600', '700']],
  ['@fontsource/ibm-plex-sans', ['400', '500', '600', '700']],
  ['@fontsource/ibm-plex-mono', ['400', '500']],
];
const cssImports = [];
for (const [pkg, weights] of fontPackages) {
  for (const w of weights) {
    const cssPath = path.join(root, 'node_modules', pkg, `files/${pkg.split('/')[1]}-latin-${w}-normal.woff2`);
    if (!fs.existsSync(cssPath)) throw new Error(`missing font ${cssPath}`);
    const dest = path.join(fontsDir, `${pkg.split('/')[1]}-${w}.woff2`);
    fs.copyFileSync(cssPath, dest);
    cssImports.push({ pkg: pkg.split('/')[1], w });
  }
}

const fontCss = cssImports.map(({ pkg, w }) => {
  const family = pkg === 'archivo-narrow' ? 'Archivo Narrow' : pkg === 'ibm-plex-sans' ? 'IBM Plex Sans' : 'IBM Plex Mono';
  const weight = w;
  return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weight};src:url('/assets/fonts/${pkg}-${w}.woff2') format('woff2')}`;
}).join('\n');

const appCss = fs.readFileSync(path.join(root, 'src/browser/app.css'), 'utf8');
fs.mkdirSync(path.join(root, 'public/assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/assets/app.css'), fontCss + '\n' + appCss);

// Build the browser bundle and the server, then the app page.
await build({
  entryPoints: [path.join(root, 'src/browser/main.ts')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(root, 'public/assets/app.js'),
  legalComments: 'none',
});

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist/server.js'),
  external: ['pg', 'pg-native', 'nodemailer'],
  legalComments: 'none',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const appHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stationhouse</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" type="module"></script>
</body>
</html>`;
fs.writeFileSync(path.join(root, 'public/index.html'), appHtml);

// The schema travels with the server bundle's source directory.
fs.copyFileSync(path.join(root, 'src/server/schema.sql'), path.join(root, 'dist/schema.sql'));
console.log('built');
