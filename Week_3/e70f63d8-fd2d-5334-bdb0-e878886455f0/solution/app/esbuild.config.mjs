import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

await rm('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
});

const client = await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/client/assets',
  entryNames: '[name]-[hash]',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  minify: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  metafile: true,
  external: ['/fonts/*'],
});

await cp('public/fonts', 'dist/client/fonts', { recursive: true });

const outputs = Object.keys(client.metafile.outputs).map((path) => basename(path));
const script = outputs.find((name) => name.endsWith('.js'));
const style = outputs.find((name) => name.endsWith('.css'));
const template = await readFile('src/client/index.html', 'utf8');
await mkdir('dist/client', { recursive: true });
await writeFile(
  'dist/client/index.html',
  template.replace('<!--script-->', `<script type="module" src="/assets/${script}"></script>`).replace('<!--style-->', `<link rel="stylesheet" href="/assets/${style}">`),
);
