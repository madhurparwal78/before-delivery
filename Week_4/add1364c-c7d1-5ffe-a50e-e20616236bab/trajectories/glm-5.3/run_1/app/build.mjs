import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
mkdirSync(join(root, 'dist/client/assets'), { recursive: true });

// Bundle the server (external deps stay as node modules)
await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(root, 'dist/server.js'),
  external: ['pg', '@date-fns/tz', 'bcryptjs'],
  packages: 'external',
  sourcemap: false,
  logLevel: 'info'
});

// Bundle the client
await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outfile: join(root, 'dist/client/assets/app.js'),
  sourcemap: false,
  logLevel: 'info',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }
});

// Copy static files
mkdirSync(join(root, 'dist/client/fonts'), { recursive: true });
copyFileSync(join(root, 'public/index.html'), join(root, 'dist/client/index.html'));
copyFileSync(join(root, 'public/styles.css'), join(root, 'dist/client/assets/styles.css'));
copyFileSync(join(root, 'public/fonts/funnel-display.ttf'), join(root, 'dist/client/fonts/funnel-display.ttf'));
copyFileSync(join(root, 'public/fonts/funnel-sans.ttf'), join(root, 'dist/client/fonts/funnel-sans.ttf'));

console.log('build complete');
