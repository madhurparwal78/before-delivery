import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = dirname(import.meta.dirname);
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

/** Latin-subset woff2 faces copied into the build and declared in web/fonts.css. */
const FONT_FACES = [
  ['space-grotesk', 'latin-400-normal'],
  ['space-grotesk', 'latin-500-normal'],
  ['space-grotesk', 'latin-700-normal'],
  ['ibm-plex-sans', 'latin-400-normal'],
  ['ibm-plex-sans', 'latin-500-normal'],
  ['ibm-plex-sans', 'latin-600-normal'],
  ['ibm-plex-mono', 'latin-400-normal'],
  ['ibm-plex-mono', 'latin-500-normal'],
  ['ibm-plex-mono', 'latin-600-normal'],
];

await rm(dist, { recursive: true, force: true });
await mkdir(join(publicDir, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  loader: { '.sql': 'text' },
});

await build({
  entryPoints: [join(root, 'src/web/main.ts')],
  outfile: join(publicDir, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

for (const [pkg, face] of FONT_FACES) {
  const name = `${pkg}-${face}.woff2`;
  await copyFile(
    join(root, 'node_modules/@fontsource', pkg, 'files', name),
    join(publicDir, 'fonts', name),
  );
}

const cssParts = [];
for (const name of ['fonts.css', 'styles.css']) {
  cssParts.push(await readFile(join(root, 'src/web', name), 'utf8'));
}
await writeFile(join(publicDir, 'styles.css'), cssParts.join('\n'));
await copyFile(join(root, 'src/web/index.html'), join(publicDir, 'index.html'));

console.log('build complete');
