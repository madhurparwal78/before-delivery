import { build } from 'esbuild';
import { mkdirSync, copyFileSync, cpSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

// server: bundle to a single ESM file
await build({
  entryPoints: ['src/server/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  packages: 'external',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
});

// client bundles
for (const entry of ['editor', 'account', 'home']) {
  await build({
    entryPoints: [`src/client/${entry}.ts`],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: `dist/assets/${entry}.js`,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
  });
}

mkdirSync('dist/assets', { recursive: true });
cpSync('public_src', 'dist/assets', { recursive: true });
console.log('built');
