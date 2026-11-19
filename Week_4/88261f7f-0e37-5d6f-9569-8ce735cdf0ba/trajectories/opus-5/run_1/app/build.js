const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;

execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

const outDir = path.join(root, 'dist', 'public');
fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  outfile: path.join(outDir, 'app.js'),
  minify: true,
  logLevel: 'info',
});

for (const name of fs.readdirSync(path.join(root, 'src', 'public'))) {
  fs.copyFileSync(path.join(root, 'src', 'public', name), path.join(outDir, name));
}
