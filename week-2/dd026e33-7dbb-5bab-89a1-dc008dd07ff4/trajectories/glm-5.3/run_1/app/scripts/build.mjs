import { build } from 'esbuild';
import { mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// Server: bundle to plain JS for the Node runtime
await build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/main.js',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

// Browser: one bundle plus the stylesheet, the shell and the fonts
mkdirSync('dist/browser-assets', { recursive: true });
await build({
  entryPoints: ['browser/app.ts'],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  outfile: 'dist/browser-assets/lacquer.js',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});
cpSync('browser/styles.css', 'dist/browser-assets/lacquer.css');
cpSync('browser/index.html', 'dist/browser-assets/index.html');
mkdirSync('dist/browser-assets/fonts', { recursive: true });
const fontSource = 'node_modules/@fontsource-variable/archivo/files';
cpSync(`${fontSource}/archivo-latin-wdth-normal.woff2`, 'dist/browser-assets/fonts/archivo-wdth.woff2');
cpSync('node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'dist/browser-assets/fonts/plex-sans-400.woff2');
cpSync('node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'dist/browser-assets/fonts/plex-sans-600.woff2');
cpSync('node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'dist/browser-assets/fonts/plex-mono-400.woff2');
cpSync('node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'dist/browser-assets/fonts/plex-mono-600.woff2');
console.log('assets', readdirSync('dist/browser-assets').join(', '));
console.log('build done');
