// Build: typecheck, bundle the server and the browser app into dist/.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execSync('npx tsc --noEmit', { cwd: root, stdio: 'inherit' });

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'dist/public'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist/server.js'),
  external: ['argon2', 'pg-native'],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join('\n'),
  },
  minify: false,
  sourcemap: false,
  logLevel: 'error',
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scopewright</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

await build({
  entryPoints: [path.join(root, 'src/browser/main.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'firefox121', 'safari17'],
  outfile: path.join(root, 'dist/public/app.js'),
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  logLevel: 'error',
});

const css = await build({
  entryPoints: [path.join(root, 'src/browser/app.css')],
  bundle: true,
  outfile: path.join(root, 'dist/public/app.css'),
  minify: true,
  sourcemap: false,
  logLevel: 'error',
  loader: { '.ttf': 'file' },
  assetNames: 'assets/[name]',
  publicPath: '/',
});

fs.writeFileSync(path.join(root, 'dist/public/index.html'), html);

console.log('build complete');
