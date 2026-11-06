import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/assets/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
});

await build({
  entryPoints: ['src/styles/app.css'],
  outfile: 'dist/public/assets/app.css',
  bundle: true,
  minify: true,
  external: ['/assets/fonts/*'],
});

await cp('public/fonts', 'dist/public/assets/fonts', { recursive: true });
