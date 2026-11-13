import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// Server bundle.
await build({
  entryPoints: ['src/serve.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/serve.js',
  sourcemap: false,
  external: ['pg-native'],
  banner: { js: `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);` },
});
console.log('server bundled');

// Client bundle (three.js + page controllers, no minify for debuggability).
await build({
  entryPoints: ['src/client/app.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'public/assets/app.js',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});
console.log('client bundled');

// Public assets are served from public/ directly.
console.log('build complete');
