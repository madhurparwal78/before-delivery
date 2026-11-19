import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/public',
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome110', 'firefox110', 'safari16'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'css' },
  external: ['/fonts/*'],
  sourcemap: false,
});

await cp('public', 'dist/public', { recursive: true });
const shell = await readFile('src/client/index.html', 'utf8');
await writeFile('dist/public/index.html', shell);
