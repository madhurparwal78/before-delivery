import { cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets/fonts', { recursive: true });

run('npx', ['tsc', '-p', 'tsconfig.json']);
run('npx', ['tsc', '-p', 'tsconfig.client.json']);

await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  outfile: 'dist/public/assets/app.js',
});

await cp('public/app.css', 'dist/public/assets/app.css');

const fonts = [
  ['@fontsource/instrument-serif', 'instrument-serif-latin-400-normal.woff2'],
  ['@fontsource/instrument-serif', 'instrument-serif-latin-ext-400-normal.woff2'],
  ['@fontsource/instrument-sans', 'instrument-sans-latin-400-normal.woff2'],
  ['@fontsource/instrument-sans', 'instrument-sans-latin-ext-400-normal.woff2'],
  ['@fontsource/instrument-sans', 'instrument-sans-latin-500-normal.woff2'],
  ['@fontsource/instrument-sans', 'instrument-sans-latin-600-normal.woff2'],
];
for (const [pkg, file] of fonts) {
  await cp(`node_modules/${pkg}/files/${file}`, `dist/public/assets/fonts/${file}`);
}
