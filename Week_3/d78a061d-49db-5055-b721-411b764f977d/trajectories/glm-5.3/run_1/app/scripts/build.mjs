#!/usr/bin/env node
// Single shared build driver for server and client bundles.
import { build } from 'esbuild';
import cssModulesPlugin from 'esbuild-css-modules-plugin';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

rmSync(path('dist'), { recursive: true, force: true });
mkdirSync(path('dist'), { recursive: true });
mkdirSync(path('dist/client'), { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const serverOptions = {
  entryPoints: [path('src/server/main.ts')],
  outdir: path('dist/server'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outExtension: { '.js': '.cjs' },
  sourcemap: false,
  external: ['pg-native', 'gltf-validator'],
  logLevel: 'error',
  loader: { '.woff2': 'file' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
};

/** @type {import('esbuild').BuildOptions} */
const clientOptions = {
  entryPoints: [path('src/client/main.ts')],
  outdir: path('dist/client'),
  outbase: path('src/client'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'error',
  minify: true,
  plugins: [cssModulesPlugin({ filter: /\.css$/ })],
  outExtension: { '.js': '.js' },
  publicPath: '/assets',
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]-[hash]',
};

await build(serverOptions);
await build(clientOptions);

console.log('build ok');
