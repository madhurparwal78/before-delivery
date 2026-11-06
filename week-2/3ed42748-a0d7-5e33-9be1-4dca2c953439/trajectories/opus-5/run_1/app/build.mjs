import { build } from 'esbuild';
import { mkdir, cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/public/fonts`, { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: {
    game: 'src/client/game/main.ts',
    console: 'src/client/console/main.ts',
    claim: 'src/client/claim/main.ts',
  },
  outdir: `${out}/public`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/styles/paper.css'],
  outfile: `${out}/public/paper.css`,
  bundle: true,
  external: ['/assets/*'],
  minify: true,
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/fraunces/files/fraunces-latin-600-normal.woff2', 'fraunces-600.woff2'],
  [
    '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2',
    'atkinson-400.woff2',
  ],
  [
    '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2',
    'atkinson-700.woff2',
  ],
];
for (const [spec, name] of fonts) {
  await cp(require.resolve(spec), `${out}/public/fonts/${name}`);
}



