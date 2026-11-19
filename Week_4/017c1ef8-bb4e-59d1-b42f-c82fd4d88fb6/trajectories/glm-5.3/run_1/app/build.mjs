import { build } from 'esbuild';
import { rmSync, mkdirSync, copyFileSync } from 'node:fs';

const prod = process.env.NODE_ENV !== 'development';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/client/fonts', { recursive: true });

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});

mkdirSync('client/fonts', { recursive: true });
copyFileSync('client/fonts/funnel-display.woff2', 'client/fonts/funnel-display.woff2');
copyFileSync('client/fonts/funnel-sans.woff2', 'client/fonts/funnel-sans.woff2');
await build({
  entryPoints: ['client/main.tsx'],
  bundle: true,
  platform: 'browser',
  target: ['chrome110', 'firefox110', 'safari16'],
  format: 'esm',
  outdir: 'dist/client',
  entryNames: 'app',
  sourcemap: false,
  minify: prod,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
  assetNames: '[name]',
  loader: { '.woff2': 'file' },
  publicPath: '/fonts/',
});

copyFileSync('client/index.html', 'dist/client/index.html');
copyFileSync('client/fonts/funnel-display.woff2', 'dist/client/fonts/funnel-display.woff2');
copyFileSync('client/fonts/funnel-sans.woff2', 'dist/client/fonts/funnel-sans.woff2');
console.log('build complete');
