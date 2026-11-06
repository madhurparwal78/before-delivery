import { build } from 'esbuild';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const pub = join(dist, 'public');
const fonts = join(pub, 'fonts');

rmSync(dist, { recursive: true, force: true });
mkdirSync(fonts, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/server.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: ['pg', 'pg-native'],
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(pub, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  sourcemap: false,
  minify: false,
});

await build({
  entryPoints: [join(root, 'src/client/share.ts')],
  outfile: join(pub, 'share.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  sourcemap: false,
  minify: false,
});

for (const name of ['styles', 'share']) {
  await build({
    entryPoints: [join(root, `src/client/${name}.css`)],
    outfile: join(pub, `${name === 'styles' ? 'app' : 'share'}.css`),
    bundle: true,
    external: ['/fonts/*'],
  });
}

const fontFiles = [
  ['@fontsource/fraunces/files/fraunces-latin-400-normal.woff2', 'fraunces-400.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-600-normal.woff2', 'fraunces-600.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2', 'source-serif-4-400.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2', 'source-serif-4-600.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2', 'source-serif-4-400-italic.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
];
for (const [from, to] of fontFiles) {
  copyFileSync(join(root, 'node_modules', from), join(fonts, to));
}

console.log('build complete');
