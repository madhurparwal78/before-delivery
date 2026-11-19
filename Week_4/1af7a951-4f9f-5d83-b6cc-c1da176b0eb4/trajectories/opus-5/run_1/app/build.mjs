import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'dist', 'public');

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const run = (args) => execFileSync(process.execPath, [tsc, ...args], { stdio: 'inherit', cwd: root });

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run(['-p', 'tsconfig.json']);
run(['-p', 'tsconfig.client.json']);
run(['-p', 'tsconfig.sw.json']);

mkdirSync(path.join(publicDir, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'client', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: path.join(publicDir, 'app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

await build({
  entryPoints: [path.join(root, 'client', 'sw.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: path.join(publicDir, 'sw.js'),
  minify: true,
  legalComments: 'none',
});

await build({
  entryPoints: [path.join(root, 'client', 'styles.css')],
  bundle: true,
  outfile: path.join(publicDir, 'app.css'),
  minify: true,
  loader: { '.woff2': 'empty' },
  external: ['/fonts/*'],
});

const fonts = [
  ['@fontsource/fraunces/files/fraunces-latin-600-normal.woff2', 'fraunces-600.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff2', 'fraunces-600-ext.woff2'],
  ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-400.woff2'],
  ['@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-400-normal.woff2', 'atkinson-400-ext.woff2'],
];
for (const [from, to] of fonts) {
  cpSync(path.join(root, 'node_modules', from), path.join(publicDir, 'fonts', to));
}

cpSync(path.join(root, 'client', 'index.html'), path.join(publicDir, 'index.html'));
