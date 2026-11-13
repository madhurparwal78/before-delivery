// Builds the browser bundle and compiles the server to runnable JS.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The dist directory is rebuilt from scratch so no stale output survives.
if (existsSync('dist')) rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
mkdirSync('dist/assets/fonts', { recursive: true });

// Typecheck both halves, then bundle.
execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { stdio: 'inherit' });
execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.browser.json'], { stdio: 'inherit' });

await build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: false,
  outfile: 'dist/browser.js',
  logLevel: 'silent',
});

// Bundle the whole server into one CommonJS file (the .cjs extension keeps
// Node from treating it as an ES module), then write the "serve" entry.
await build({
  entryPoints: ['src/server/server.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  outfile: 'dist/server.cjs',
  logLevel: 'silent',
});
writeFileSync('dist/server.js',
  `import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./server.cjs');\n`);

// Static assets: the shell page, the stylesheet and the bundled typefaces.
writeFileSync('dist/index.html', [
  '<!doctype html>',
  '<html lang="en-GB">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  '  <title>Holmgarth Aftercare — Fittings Desk</title>',
  '  <link rel="stylesheet" href="/styles.css">',
  '</head>',
  '<body>',
  '  <div id="app"></div>',
  '  <script src="/browser.js"></script>',
  '</body>',
  '</html>',
  '',
].join('\n'));
copyFileSync('src/styles.css', 'dist/styles.css');
const fontPackages = [
  ['@fontsource/space-grotesk', 'space-grotesk'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono'],
];
for (const [pkg, prefix] of fontPackages) {
  const files = readdirSync(`node_modules/${pkg}/files`);
  for (const file of files) {
    if (file.endsWith('.woff2')) copyFileSync(`node_modules/${pkg}/files/${file}`, `dist/assets/fonts/${file}`);
  }
}
console.log('build done');

