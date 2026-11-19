import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

const lucidePlugin = {
  name: 'lucide',
  setup(b) {
    b.onResolve({ filter: /^lucide:/ }, (args) => ({
      path: join(root, 'node_modules/lucide-static/icons', `${args.path.slice('lucide:'.length)}.svg`),
      namespace: 'lucide',
    }));
    b.onLoad({ filter: /.*/, namespace: 'lucide' }, async (args) => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))};`,
      loader: 'js',
    }));
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'public', 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(out, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/client/main.tsx')],
  outfile: join(out, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  sourcemap: false,
  plugins: [lucidePlugin],
  logLevel: 'warning',
});

const fonts = [
  ['@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', 'instrument-serif-400.woff2'],
  ['@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2', 'instrument-serif-400-ext.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2', 'plex-sans-400-ext.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2', 'plex-sans-600-ext.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-400-normal.woff2', 'plex-mono-400-ext.woff2'],
];
for (const [from, to] of fonts) {
  await copyFile(join(root, 'node_modules', from), join(out, 'public/fonts', to));
}

await copyFile(join(root, 'src/client/app.css'), join(out, 'public/app.css'));
await writeFile(join(out, 'public/index.html'), await readFile(join(root, 'src/client/index.html'), 'utf8'));

console.log('build complete');
