import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const pub = path.join(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(pub, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  outfile: path.join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg', 'pg-native'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  outfile: path.join(pub, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari16'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/archivo/files/archivo-latin-500-normal.woff2', 'archivo-500.woff2'],
  ['@fontsource/archivo/files/archivo-latin-600-normal.woff2', 'archivo-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'plex-mono-500.woff2'],
];
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(pub, 'fonts', to));
}

await cp(path.join(root, 'src/client/styles.css'), path.join(pub, 'styles.css'));
await cp(path.join(root, 'src/client/index.html'), path.join(pub, 'index.html'));

const { seededExhibitPdf, SEEDED_EXHIBITS } = await import(path.join(root, 'scripts/exhibits.mjs'));
const exhibitDir = path.join(dist, 'exhibits');
await mkdir(exhibitDir, { recursive: true });
const manifest = [];
for (const spec of SEEDED_EXHIBITS) {
  const bytes = seededExhibitPdf(spec);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(exhibitDir, `${spec.accession}.pdf`), bytes);
  manifest.push({ accession: spec.accession, sha256, bytes: bytes.length });
}
await writeFile(path.join(exhibitDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const indexHtml = await readFile(path.join(pub, 'index.html'), 'utf8');
if (!indexHtml.includes('app.js')) throw new Error('index.html does not reference app.js');
console.log('build complete');
