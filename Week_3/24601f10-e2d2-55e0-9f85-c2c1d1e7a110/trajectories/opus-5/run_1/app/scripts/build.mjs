import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');

rmSync(resolve(root, 'dist'), { recursive: true, force: true });

execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });

await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: resolve(root, 'dist/public/app.js'),
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});

mkdirSync(resolve(root, 'dist/public/fonts'), { recursive: true });
cpSync(resolve(root, 'assets/fonts/Geist-Variable.woff2'), resolve(root, 'dist/public/fonts/Geist-Variable.woff2'));
cpSync(resolve(root, 'assets/fonts/GeistMono-Variable.woff2'), resolve(root, 'dist/public/fonts/GeistMono-Variable.woff2'));
cpSync(resolve(root, 'src/client/app.css'), resolve(root, 'dist/public/app.css'));
cpSync(resolve(root, 'src/client/index.html'), resolve(root, 'dist/public/index.html'));
cpSync(resolve(root, 'src/server/schema.sql'), resolve(root, 'dist/server/server/schema.sql'));
