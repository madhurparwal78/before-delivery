import { build } from 'esbuild';
import { mkdir, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outdir: path.join(dist, 'server'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  outfile: path.join(dist, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
});

await build({
  entryPoints: [path.join(root, 'src/client/styles.css')],
  outfile: path.join(dist, 'public/app.css'),
  bundle: true,
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]',
  minify: true,
});

const files = [];
async function walk(dir, base) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, `${base}${entry.name}/`);
    else files.push(`${base}${entry.name}`);
  }
}
await walk(path.join(dist, 'public'), '');

const hashes = {};
for (const rel of files) {
  const bytes = await readFile(path.join(dist, 'public', rel));
  hashes[rel] = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}
await writeFile(path.join(dist, 'public/asset-manifest.json'), JSON.stringify(hashes));

console.log(`built ${files.length} public assets`);
