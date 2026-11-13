import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/index.ts')],
  outfile: resolve(out, 'server/index.js'),
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/main.tsx')],
  outfile: resolve(out, 'public/app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  bundle: true,
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await build({
  entryPoints: [resolve(root, 'src/client/styles.css')],
  outfile: resolve(out, 'public/app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

await cp(resolve(root, 'public/fonts'), resolve(out, 'public/fonts'), { recursive: true });

const html = await readFile(resolve(root, 'src/client/index.html'), 'utf8');
await writeFile(resolve(out, 'public/index.html'), html);
