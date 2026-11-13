import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client/assets', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/index.js',
  packages: 'external',
  loader: { '.sql': 'text' },
});

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  outdir: 'dist/client/assets',
  minify: true,
  jsx: 'automatic',
  publicPath: '/assets/',
  assetNames: '[name]-[hash]',
  loader: { '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

await writeFile('dist/client/index.html', await readFile('src/client/index.html', 'utf8'));
