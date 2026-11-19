import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const pub = path.join(dist, 'public');
const assets = path.join(root, 'assets-src');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(pub, 'assets', 'fonts'), { recursive: true });
fs.mkdirSync(path.join(pub, 'assets', 'wasm'), { recursive: true });

for (const f of ['FiraSans-Regular.ttf', 'FiraSans-SemiBold.ttf', 'FiraSans-Bold.ttf', 'OFL.txt']) {
  fs.copyFileSync(path.join(assets, 'fonts', f), path.join(pub, 'assets', 'fonts', f));
}

// Copy the HTML shell and stylesheet
fs.copyFileSync(path.join(src, 'client', 'index.html'), path.join(pub, 'index.html'));
fs.copyFileSync(path.join(src, 'client', 'styles.css'), path.join(pub, 'assets', 'app.css'));

fs.copyFileSync(path.join(root, 'vendor', 'manifold', 'manifold.wasm'), path.join(pub, 'assets', 'wasm', 'manifold.wasm'));

const nodeModulePlugin = {
  name: 'stub-node-module',
  setup(build) {
    build.onResolve({ filter: /^node:module$/ }, () => ({
      path: 'stub-node-module',
      namespace: 'stub-node-module',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-node-module' }, () => ({
      contents: 'export const createRequire = () => () => ({});',
      loader: 'js',
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(src, 'worker', 'geometryWorker.ts'), path.join(src, 'worker', 'exportWorker.ts')],
  outdir: path.join(pub, 'assets'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  plugins: [nodeModulePlugin],
});

await esbuild.build({
  entryPoints: [path.join(src, 'client', 'main.tsx')],
  outdir: pub,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  splitting: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text' },
});

await esbuild.build({
  entryPoints: [path.join(src, 'server', 'main.ts')],
  outfile: path.join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: false,
  packages: 'external',
});

console.log('build complete');
