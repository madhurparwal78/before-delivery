import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/public/fonts`, { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg', 'ws', 'pg-native'],
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: `${out}/public/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/inter/files/inter-latin-300-normal.woff2', 'inter-300.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
  ['@fontsource/inter-tight/files/inter-tight-latin-700-normal.woff2', 'inter-tight-700.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff2', 'mono-300.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'mono-400.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2', 'mono-500.woff2'],
];
for (const [from, to] of fonts) {
  await cp(`node_modules/${from}`, `${out}/public/fonts/${to}`);
}

await cp('src/client/app.css', `${out}/public/app.css`);
const html = await readFile('src/client/index.html', 'utf8');
await writeFile(`${out}/public/index.html`, html);
console.log('build done');
