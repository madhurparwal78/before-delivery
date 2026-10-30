import { build } from 'esbuild';
import { mkdirSync, rmSync, cpSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
rmSync('public/build', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src/server/schema.sql', 'dist/schema.sql');

// Server: bundle the server entry into one file.
await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server/main.js',
  packages: 'external',
  legalComments: 'none',
  sourcemap: false,
});

// Browser: bundle the app entry plus CSS.
await build({
  entryPoints: ['src/browser/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'public/build/app.js',
  legalComments: 'none',
  sourcemap: false,
  minify: false,
});

// The stylesheet is standalone: copy it so url() references stay untouched.
cpSync('src/browser/styles.css', 'public/build/app.css');

mkdirSync('public/fonts', { recursive: true });
cpSync('assets/fonts', 'public/fonts', { recursive: true });
mkdirSync('public/icons', { recursive: true });
cpSync('assets/icons', 'public/icons', { recursive: true });
console.log('build complete');
