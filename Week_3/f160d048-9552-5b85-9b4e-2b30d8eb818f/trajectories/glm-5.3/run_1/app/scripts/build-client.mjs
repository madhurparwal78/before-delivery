// Build script: compile the server, bundle the client, copy static assets.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

fs.copyFileSync(path.join(root, 'src/server/schema.sql'), path.join(root, 'dist/src/server/schema.sql'));

const publicDir = path.join(root, 'dist/src/server/public');
fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
fs.mkdirSync(path.join(publicDir, 'fonts'), { recursive: true });

fs.copyFileSync(path.join(root, 'public-src/fonts/literata.css'), path.join(publicDir, 'fonts/literata.css'));
for (const file of fs.readdirSync(path.join(root, 'public-src/fonts'))) {
  if (file.endsWith('.woff2')) {
    fs.copyFileSync(path.join(root, `public-src/fonts/${file}`), path.join(publicDir, `fonts/${file}`));
  }
}
fs.copyFileSync(path.join(root, 'public-src/index.html'), path.join(publicDir, 'index.html'));
fs.copyFileSync(path.join(root, 'public-src/styles.css'), path.join(publicDir, 'assets/styles.css'));

execFileSync('npx', [
  'esbuild',
  'src/client/client.ts',
  '--bundle',
  '--format=esm',
  '--target=es2022',
  `--outfile=${path.join(publicDir, 'assets/client.js')}`,
  '--legal-comments=none',
], { cwd: root, stdio: 'inherit' });

console.log('build complete');
