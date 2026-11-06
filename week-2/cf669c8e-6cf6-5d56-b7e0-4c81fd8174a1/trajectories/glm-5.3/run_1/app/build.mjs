// Build: bundle the client SPA and esbuild-free server to plain JS.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist/public/fonts', { recursive: true });

// Client bundle: one JS, one CSS. Fonts are copied and referenced by relative path.
await build({
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  outfile: 'dist/public/app.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});

// Copy the stylesheet with font URLs rewritten to the copied font paths.
const rawCss = readFileSync('src/client/styles.css', 'utf8');
mkdirSync('dist/public', { recursive: true });
writeFileSync('dist/public/app.css', rawCss.replace(/url\((['"]?)fonts\/([A-Za-z-]+\.ttf)\1\)/g, 'url(fonts/$2)'));

// Server: each module compiled standalone to CJS-compatible ESM (node can run ESM directly).
await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server/main.js',
  external: ['pg', 'nodemailer', 'three'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'silent',
});

copyFileSync('public/fonts/BigShouldersDisplay.ttf', 'dist/public/fonts/BigShouldersDisplay.ttf');
copyFileSync('public/fonts/IBMPlexSans.ttf', 'dist/public/fonts/IBMPlexSans.ttf');
copyFileSync('public/fonts/IBMPlexMono-Regular.ttf', 'dist/public/fonts/IBMPlexMono-Regular.ttf');
copyFileSync('public/fonts/IBMPlexMono-Medium.ttf', 'dist/public/fonts/IBMPlexMono-Medium.ttf');
copyFileSync('public/fonts/IBMPlexMono-Bold.ttf', 'dist/public/fonts/IBMPlexMono-Bold.ttf');

writeFileSync('dist/public/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ommezwaai Feeler</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script src="/app.js" type="module"></script>
</body>
</html>
`);
console.log('build complete');
