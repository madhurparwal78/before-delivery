import { build } from 'esbuild';
import { mkdirSync, rmSync, cpSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// server: bundle to plain JS with dependencies inlined except node builtins
await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  packages: 'external',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

// frontend
await build({
  entryPoints: ['src/frontend/main.tsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  outfile: 'dist/app.js',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

// public assets
cpSync('public', 'dist', { recursive: true });
cpSync('src/server/schema.sql', 'dist/schema.sql');
cpSync('src/frontend/index.html', 'dist/index.html');
console.log('build done');
