import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/public', { recursive: true });

const shared = { bundle: true, logLevel: 'info', sourcemap: false, legalComments: 'none' };

await build({
  ...shared,
  entryPoints: { server: 'src/server/main.ts' },
  outdir: 'dist',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
});

await build({
  ...shared,
  entryPoints: { app: 'src/client/app/main.tsx', reader: 'src/client/reader/main.ts' },
  outdir: 'dist/public',
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
});

cpSync('src/client/styles.css', 'dist/public/styles.css');
cpSync('assets/fonts', 'dist/public/fonts', { recursive: true });
