import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client/assets', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server/main.js',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/client/assets',
  bundle: true,
  minify: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  jsx: 'automatic',
  sourcemap: false,
  external: ['/fonts/*'],
  logLevel: 'info',
});

await cp('public', 'dist/client', { recursive: true });
const html = await readFile('src/client/index.html', 'utf8');
await writeFile('dist/client/index.html', html);
