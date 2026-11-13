const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'public');

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const fonts = [
  ['@fontsource/chivo/files/chivo-latin-400-normal.woff2', 'chivo-400.woff2'],
  ['@fontsource/chivo/files/chivo-latin-700-normal.woff2', 'chivo-700.woff2'],
  ['@fontsource/chivo/files/chivo-latin-900-normal.woff2', 'chivo-900.woff2'],
  ['@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'plex-arabic-400.woff2'],
  ['@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2', 'plex-arabic-700.woff2'],
];
for (const [from, to] of fonts) {
  fs.copyFileSync(path.join(root, 'node_modules', from), path.join(out, 'fonts', to));
}

fs.copyFileSync(path.join(root, 'public', 'app.css'), path.join(out, 'app.css'));

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  outfile: path.join(out, 'app.js'),
  minify: true,
  logLevel: 'info',
});
