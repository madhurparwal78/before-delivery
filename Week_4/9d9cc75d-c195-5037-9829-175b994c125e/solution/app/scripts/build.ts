import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.LOZ_DIST ?? path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public', 'assets'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(dist, 'server', 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
});

const client = await build({
  entryPoints: { app: path.join(root, 'src/client/main.tsx') },
  outdir: path.join(dist, 'public', 'assets'),
  entryNames: '[name]-[hash]',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  metafile: true,
  logLevel: 'warning',
  loader: { '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });

const outputs = Object.keys(client.metafile.outputs).map((file) => path.basename(file));
const script = outputs.find((file) => file.endsWith('.js'));
const style = outputs.find((file) => file.endsWith('.css'));
if (!script) throw new Error('client bundle produced no script');
const template = await readFile(path.join(root, 'src/client/index.html'), 'utf8');
const html = template
  .replace('<!--STYLE-->', style ? `<link rel="stylesheet" href="/assets/${style}">` : '')
  .replace('<!--SCRIPT-->', `<script type="module" src="/assets/${script}"></script>`);
await writeFile(path.join(dist, 'public', 'index.html'), html);
const digest = createHash('sha256').update(html).digest('hex').slice(0, 12);
console.log(`built client ${script} (${digest})`);
