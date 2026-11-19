import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'client'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  outfile: path.join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});

const client = await build({
  entryPoints: { app: path.join(root, 'src/client/main.tsx') },
  outdir: path.join(dist, 'client/assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const outputs = Object.keys(client.metafile.outputs).map((file) => path.basename(file));
const script = outputs.find((file) => file.startsWith('app-') && file.endsWith('.js'));
const style = outputs.find((file) => file.startsWith('app-') && file.endsWith('.css'));
if (!script || !style) throw new Error('client bundle is missing its script or stylesheet');

const template = await readFile(path.join(root, 'src/client/index.html'), 'utf8');
await writeFile(
  path.join(dist, 'client/index.html'),
  template.replace('%STYLE%', `/assets/${style}`).replace('%SCRIPT%', `/assets/${script}`),
);
