'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });

execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

esbuild.buildSync({
  entryPoints: [path.join(root, 'web', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: path.join(dist, 'public', 'app.js'),
});

const assets = path.join(dist, 'public');
fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'public', 'fonts'))) {
  fs.copyFileSync(path.join(root, 'public', 'fonts', file), path.join(assets, 'fonts', file));
}
fs.copyFileSync(path.join(root, 'web', 'app.css'), path.join(assets, 'app.css'));

process.stdout.write('build complete\n');
