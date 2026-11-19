import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public', 'assets'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(dist, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'external',
  banner: {
    js: "import { createRequire as __lfRequire } from 'node:module'; const require = __lfRequire(import.meta.url);",
  },
});

const fonts = [
  ['@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2', 'space-grotesk-400.woff2'],
  ['@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2', 'space-grotesk-600.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-400.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2', 'jetbrains-mono-600.woff2'],
];
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(dist, 'public/assets', to));
}

const clientOut = await build({
  entryPoints: [path.join(root, 'src/web/main.ts')],
  outfile: path.join(dist, 'public/assets/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  write: false,
});

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

let appJs = '';
for (const file of clientOut.outputFiles) appJs = file.text;
const appHash = digest(appJs);
await writeFile(path.join(dist, `public/assets/app.${appHash}.js`), appJs);

const css = await readFile(path.join(root, 'src/web/styles.css'), 'utf8');
const cssHash = digest(css);
await writeFile(path.join(dist, `public/assets/app.${cssHash}.css`), css);

const html = (await readFile(path.join(root, 'src/web/index.html'), 'utf8'))
  .replace('__CSS__', `/assets/app.${cssHash}.css`)
  .replace('__JS__', `/assets/app.${appHash}.js`);
await writeFile(path.join(dist, 'public/index.html'), html);

await cp(path.join(root, 'src/web/favicon.svg'), path.join(dist, 'public/assets/favicon.svg'));

console.log('build complete');
