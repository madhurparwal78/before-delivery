import { build } from 'esbuild';
import { mkdir, cp, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const pub = path.join(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(pub, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/web/main.tsx')],
  outfile: path.join(pub, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'text' },
  logLevel: 'info',
});

await cp(path.join(root, 'src/web/index.html'), path.join(pub, 'index.html'));
await cp(path.join(root, 'src/web/app.css'), path.join(pub, 'app.css'));

const fontDir = path.join(root, 'node_modules/@fontsource/fira-sans/files');
const wanted = [
  'fira-sans-latin-400-normal.woff2',
  'fira-sans-latin-500-normal.woff2',
  'fira-sans-latin-700-normal.woff2',
  'fira-sans-latin-800-normal.woff2',
];
const available = await readdir(fontDir);
for (const file of wanted) {
  if (!available.includes(file)) throw new Error(`missing bundled font file ${file}`);
  await cp(path.join(fontDir, file), path.join(pub, 'fonts', file));
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(dist, 'build-info.json'), JSON.stringify({ version: pkg.version }), 'utf8');
