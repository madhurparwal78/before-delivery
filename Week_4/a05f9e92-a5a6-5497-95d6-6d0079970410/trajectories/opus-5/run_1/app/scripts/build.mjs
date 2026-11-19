import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const pub = resolve(dist, 'public');

rmSync(dist, { recursive: true, force: true });

execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

mkdirSync(resolve(dist, 'sql'), { recursive: true });
copyFileSync(resolve(root, 'src/sql/schema.sql'), resolve(dist, 'sql/schema.sql'));

mkdirSync(pub, { recursive: true });
copyFileSync(resolve(root, 'web/index.html'), resolve(pub, 'index.html'));

await build({
  entryPoints: [resolve(root, 'web/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: resolve(pub, 'app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

await build({
  entryPoints: [resolve(root, 'web/app.css')],
  bundle: true,
  outfile: resolve(pub, 'app.css'),
  minify: true,
  external: ['/fonts/*'],
});

const fonts = resolve(pub, 'fonts');
mkdirSync(fonts, { recursive: true });
for (const [pkg, file] of [
  ['unbounded', 'unbounded-latin-400-normal.woff2'],
  ['unbounded', 'unbounded-latin-800-normal.woff2'],
  ['unbounded', 'unbounded-latin-900-normal.woff2'],
  ['onest', 'onest-latin-400-normal.woff2'],
  ['onest', 'onest-latin-600-normal.woff2'],
  ['onest', 'onest-latin-700-normal.woff2'],
]) {
  copyFileSync(resolve(root, `node_modules/@fontsource/${pkg}/files/${file}`), resolve(fonts, file));
}
cpSync(resolve(root, 'node_modules/@fontsource/unbounded/LICENSE'), resolve(fonts, 'Unbounded-OFL.txt'));
cpSync(resolve(root, 'node_modules/@fontsource/onest/LICENSE'), resolve(fonts, 'Onest-OFL.txt'));

console.log('build complete');
