import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'client');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/client/main.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  outdir: join(out, 'assets'),
  entryNames: '[name]-[hash]',
  external: ['/fonts/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel: 'info'
});

const files = Object.keys(result.metafile.outputs).map((p) => p.split('/').pop());
const script = files.find((f) => f.endsWith('.js'));
const style = files.find((f) => f.endsWith('.css'));
if (!script || !style) throw new Error('client bundle is missing its script or stylesheet');

await cp(join(root, 'public', 'fonts'), join(out, 'fonts'), { recursive: true });
const template = await readFile(join(root, 'src/client/index.html'), 'utf8');
await writeFile(
  join(out, 'index.html'),
  template.replace('%SCRIPT%', `/assets/${script}`).replace('%STYLE%', `/assets/${style}`)
);
