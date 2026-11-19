import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('build/public/js', { recursive: true });
mkdirSync('build/public/css', { recursive: true });
mkdirSync('build/public/fonts', { recursive: true });

await build({
  entryPoints: ['src/web/js/app.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'build/public/js/app.js',
  logLevel: 'info',
});

copyFileSync('src/web/index.html', 'build/public/index.html');
for (const file of readdirSync('src/web/css')) {
  copyFileSync(join('src/web/css', file), join('build/public/css', file));
}
for (const file of readdirSync('src/web/fonts')) {
  copyFileSync(join('src/web/fonts', file), join('build/public/fonts', file));
}

await build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg', 'ws'],
  outfile: 'build/server.js',
  logLevel: 'info',
});
console.log('build complete');
