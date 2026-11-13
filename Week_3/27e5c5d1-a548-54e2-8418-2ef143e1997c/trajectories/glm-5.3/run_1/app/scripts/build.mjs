// Build script: type-checks, compiles the server to ESM, and bundles the browser app.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const outdir = resolve(root, 'server-dist');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

console.log('Type-checking...');
execSync('npx tsc -p tsconfig.json --noEmit', { stdio: 'inherit', cwd: root });

console.log('Compiling server...');
await build({
  entryPoints: [resolve(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(outdir, 'main.mjs'),
  external: ['pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'error',
});

console.log('Bundling browser app...');
const clientOut = resolve(root, 'public');
rmSync(clientOut, { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  outfile: resolve(clientOut, 'app.js'),
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'error',
});

await build({
  entryPoints: [resolve(root, 'src/client/styles.css')],
  bundle: false,
  outfile: resolve(clientOut, 'styles.css'),
  loader: { '.css': 'css' },
  logLevel: 'error',
});

cpSync(resolve(root, 'src/client/vendor'), resolve(clientOut, 'vendor'), { recursive: true });

writeFileSync(
  resolve(clientOut, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kinfold</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="app"></div>
<script src="/app.js"></script>
</body>
</html>
`,
);

console.log('Build complete.');
