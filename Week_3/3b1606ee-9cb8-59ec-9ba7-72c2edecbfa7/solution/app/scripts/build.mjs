import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'client', 'assets'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: { app: join(root, 'src/client/main.tsx') },
  outdir: join(dist, 'client/assets'),
  entryNames: '[name]-[hash]',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome110', 'firefox110', 'safari16'],
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['/fonts/*'],
  metafile: false,
});

await cp(join(root, 'public/fonts'), join(dist, 'client/fonts'), { recursive: true });

const assets = await readdir(join(dist, 'client/assets'));
const script = assets.find((name) => name.endsWith('.js'));
const style = assets.find((name) => name.endsWith('.css'));
const html = (await readFile(join(root, 'src/client/index.html'), 'utf8'))
  .replace('<!--STYLE-->', style ? `<link rel="stylesheet" href="/assets/${style}">` : '')
  .replace('<!--SCRIPT-->', `<script type="module" src="/assets/${script}"></script>`);
await writeFile(join(dist, 'client/index.html'), html);
console.log(`built ${script}${style ? ` and ${style}` : ''} (${createHash('sha256').update(html).digest('hex').slice(0, 8)})`);
