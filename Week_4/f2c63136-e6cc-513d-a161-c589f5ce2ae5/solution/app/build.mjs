// Bundles the server (Node 22) and the browser app, and copies the bundled fonts next to them.
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const client = await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/public/assets',
  entryNames: '[name]-[hash]',
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  metafile: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

const outputs = Object.keys(client.metafile.outputs).map((file) => file.replace(/^dist\/public/, ''));
const js = outputs.find((file) => file.endsWith('.js'));
const css = outputs.find((file) => file.endsWith('.css'));
await writeFile('dist/public/manifest.json', JSON.stringify({ js, css }));
await cp('public/fonts', 'dist/public/fonts', { recursive: true });
console.log('built', (await readdir('dist/public/assets')).join(', '));
