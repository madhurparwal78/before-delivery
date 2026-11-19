// Build: bundle the client and server, generate the sample models.

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';

mkdirSync('.build', { recursive: true });
mkdirSync('public/assets', { recursive: true });

console.log('generating sample models');
const samplesBuild = await build({
  entryPoints: ['scripts/make-samples.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '.build/make-samples.mjs',
  write: false,
});
writeFileSync('.build/make-samples.mjs', samplesBuild.outputFiles[0].text);
const { generateSamples } = await import('../.build/make-samples.mjs');
generateSamples('public/samples');

console.log('bundling client');
await build({
  entryPoints: ['src/client-main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'public/assets/client.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

console.log('copying fonts and styles');
const fontSources = [
  'node_modules/@fontsource/dela-gothic-one/files/dela-gothic-one-latin-400-normal.woff2',
  'node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2',
  'node_modules/@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2',
  'node_modules/@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2',
];
for (const source of fontSources) {
  const name = source.split('/').pop() ?? '';
  copyFileSync(source, `public/assets/${name}`);
}
copyFileSync('src/client/app.css', 'public/assets/app.css');

console.log('bundling server');
await build({
  entryPoints: ['src/server-main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/server.cjs',
  sourcemap: false,
  logLevel: 'info',
  loader: { '.sql': 'text' },
});

console.log('build complete');

