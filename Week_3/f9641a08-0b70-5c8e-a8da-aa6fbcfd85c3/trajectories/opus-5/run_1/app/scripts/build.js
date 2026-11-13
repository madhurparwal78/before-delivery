'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function run(args) {
  execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: 'inherit' });
}

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run(['-p', 'tsconfig.json']);
run(['-p', 'tsconfig.client.json']);

const sqlSrc = path.join(root, 'src', 'db', 'schema.sql');
const sqlDest = path.join(root, 'dist', 'server', 'db', 'schema.sql');
fs.mkdirSync(path.dirname(sqlDest), { recursive: true });
fs.copyFileSync(sqlSrc, sqlDest);

const fontDir = path.join(root, 'public', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
const fontFiles = [
  'schibsted-grotesk-latin-400-normal.woff2',
  'schibsted-grotesk-latin-500-normal.woff2',
  'schibsted-grotesk-latin-700-normal.woff2',
  'schibsted-grotesk-latin-900-normal.woff2'
];
for (const file of fontFiles) {
  fs.copyFileSync(
    path.join(root, 'node_modules', '@fontsource', 'schibsted-grotesk', 'files', file),
    path.join(fontDir, file)
  );
}
console.log('build complete');
