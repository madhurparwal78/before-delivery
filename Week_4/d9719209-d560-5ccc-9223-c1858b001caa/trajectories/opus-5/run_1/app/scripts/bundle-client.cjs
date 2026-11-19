'use strict';
// Bundles the browser code and copies every static asset into dist/static.
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist', 'static');

fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  outfile: path.join(outDir, 'app.js'),
  logLevel: 'warning',
});

fs.copyFileSync(path.join(root, 'src', 'assets', 'app.css'), path.join(outDir, 'app.css'));
fs.copyFileSync(path.join(root, 'src', 'assets', 'icon.svg'), path.join(outDir, 'icon.svg'));

const fontsDir = path.join(root, 'src', 'assets', 'fonts');
for (const entry of fs.readdirSync(fontsDir)) {
  fs.copyFileSync(path.join(fontsDir, entry), path.join(outDir, 'fonts', entry));
}

console.log('client bundle and assets written to dist/static');
