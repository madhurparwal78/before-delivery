import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public', 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src', 'server.ts')],
  outfile: path.join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
  outfile: path.join(dist, 'public', 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/encode-sans-expanded/files/encode-sans-expanded-latin-800-normal.woff2', 'encode-sans-expanded-800.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-500-normal.woff2', 'inter-500.woff2'],
];
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(dist, 'public', 'fonts', to));
}

const css = await readFile(path.join(root, 'src', 'client', 'styles.css'), 'utf8');
await writeFile(path.join(dist, 'public', 'styles.css'), css);
