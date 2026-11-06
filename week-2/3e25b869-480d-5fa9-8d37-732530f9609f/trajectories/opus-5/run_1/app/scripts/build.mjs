import { build } from 'esbuild';
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const FONT_FAMILIES = [
  { pkg: '@fontsource/fraunces', prefix: 'fraunces', weights: ['400', '600', '700'] },
  { pkg: '@fontsource/instrument-sans', prefix: 'instrument-sans', weights: ['400', '500', '600'] },
];

async function copyFonts() {
  const target = join(publicDir, 'fonts');
  await mkdir(target, { recursive: true });
  for (const family of FONT_FAMILIES) {
    const from = join(root, 'node_modules', family.pkg, 'files');
    const names = await readdir(from);
    for (const name of names) {
      if (!name.endsWith('.woff2') || name.includes('italic')) continue;
      const wanted = family.weights.some(
        (weight) =>
          name === `${family.prefix}-latin-${weight}-normal.woff2` ||
          name === `${family.prefix}-latin-ext-${weight}-normal.woff2`,
      );
      if (wanted) await cp(join(from, name), join(target, name));
    }
    await cp(join(root, 'node_modules', family.pkg, 'LICENSE'), join(target, `${family.prefix}-LICENSE.txt`));
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  loader: { '.sql': 'text' },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(publicDir, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/styles.css')],
  outfile: join(publicDir, 'app.css'),
  bundle: true,
  minify: true,
  external: ['/assets/fonts/*'],
  logLevel: 'info',
});

await copyFonts();
