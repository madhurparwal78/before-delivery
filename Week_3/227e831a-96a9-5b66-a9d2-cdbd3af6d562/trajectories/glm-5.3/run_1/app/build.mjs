import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });
await mkdir('dist/public/assets/fonts', { recursive: true });

const serverResult = await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/server/main.cjs',
  sourcemap: false,
  packages: 'external',
  logLevel: 'silent',
});
if (serverResult.errors.length > 0) throw new Error('server build failed');

const clientResult = await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  outfile: 'dist/public/assets/app.js',
  sourcemap: false,
  logLevel: 'silent',
});
if (clientResult.errors.length > 0) throw new Error('client build failed');

const swResult = await build({
  entryPoints: ['src/client/sw.ts'],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  outfile: 'dist/public/sw.js',
  sourcemap: false,
  logLevel: 'silent',
});
if (swResult.errors.length > 0) throw new Error('service worker build failed');

const cssResult = await build({
  entryPoints: ['src/client/app.css'],
  bundle: true,
  outfile: 'dist/public/assets/app.css',
  loader: { '.woff2': 'file' },
  external: ['/assets/fonts/*'],
  logLevel: 'silent',
});
if (cssResult.errors.length > 0) throw new Error('css build failed');

let tscOut = '';
try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], { stdio: 'pipe', encoding: 'utf8' });
} catch (error) {
  tscOut = String(error.stdout ?? '') + String(error.stderr ?? '');
}
if (tscOut.trim()) throw new Error(tscOut);

await cp('src/public/fonts', 'dist/public/assets/fonts', { recursive: true });
const indexSrc = await readFile('src/public/index.html', 'utf8');
await writeFile('dist/public/index.html', indexSrc);
console.log('build complete');
