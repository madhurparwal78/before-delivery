#!/usr/bin/env node
// Bundles the browser TypeScript into dist/browser and the server into dist/server.js.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distBrowser = path.join(root, 'dist', 'browser');
fs.mkdirSync(distBrowser, { recursive: true });

// Bundle the browser app.
const browserResult = await build({
  entryPoints: [path.join(root, 'src/browser/main.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  outfile: path.join(distBrowser, 'app.js'),
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
if (!browserResult) throw new Error('browser build failed');

// Copy the stylesheet and the page shell.
fs.copyFileSync(path.join(root, 'src/browser/app.css'), path.join(distBrowser, 'app.css'));
fs.copyFileSync(path.join(root, 'src/browser/html/index.html'), path.join(distBrowser, 'index.html'));

// Copy assets: fonts and photographs.
const assetsOut = path.join(distBrowser, 'assets');
fs.cpSync(path.join(root, 'assets', 'fonts'), path.join(assetsOut, 'fonts'), { recursive: true });
fs.cpSync(path.join(root, 'assets', 'photos'), path.join(assetsOut, 'photos'), { recursive: true });
fs.cpSync(path.join(root, 'assets', 'icons'), path.join(assetsOut, 'icons'), { recursive: true });

// Bundle the server (externalise node_modules).
await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  outfile: path.join(root, 'dist', 'server.js'),
  external: ['pg', 'minio', 'ws', 'express', 'cookie-parser'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
console.log('build complete');
