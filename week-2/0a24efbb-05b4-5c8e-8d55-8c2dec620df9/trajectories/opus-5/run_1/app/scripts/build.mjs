import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const FONTS = [
  ['node_modules/@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2', 'open-sans-latin-wght-normal.woff2'],
  ['node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2', 'poppins-latin-600-normal.woff2'],
];

rmSync('build', { recursive: true, force: true });

await viteBuild();

mkdirSync('build/client/fonts', { recursive: true });
for (const [from, to] of FONTS) cpSync(from, `build/client/fonts/${to}`);

await esbuild({
  entryPoints: ['src/server/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  outfile: 'build/server.js',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  logLevel: 'info',
});
