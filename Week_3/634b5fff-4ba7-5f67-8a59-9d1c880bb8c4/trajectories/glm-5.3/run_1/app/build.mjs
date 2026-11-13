import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('public/assets', { recursive: true });

// Client entry bundle
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: ['es2022', 'chrome111', 'firefox111', 'safari16'],
  outfile: 'public/assets/app.js',
  legalComments: 'inline',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Server support files read at run time
copyFileSync('src/server/schema.sql', 'dist/server/schema.sql');
copyFileSync('tale.json', 'public/tale.json');
copyFileSync('src/client/styles/app.css', 'public/assets/app.css');

// Fonts bundled as static assets
for (const name of ['Gloock-Regular.ttf', 'Newsreader-var.ttf', 'Newsreader-Italic-var.ttf']) {
  copyFileSync(`src/client/fonts/${name}`, `public/assets/${name}`);
}

console.log('build complete');
