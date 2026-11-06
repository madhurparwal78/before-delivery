import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync, cpSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist/public/fonts', { recursive: true });
mkdirSync('dist/server/schema', { recursive: true });

for (const f of readdirSync('src/server/schema')) {
  if (f.endsWith('.sql')) copyFileSync(`src/server/schema/${f}`, `dist/server/schema/${f}`);
}

const result = await build({
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: './jsx',
  outfile: 'dist/public/app.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info'
});

for (const f of readdirSync('public-src/fonts')) {
  if (f.endsWith('.woff2')) copyFileSync(`public-src/fonts/${f}`, `dist/public/fonts/${f}`);
}
cpSync('src/client/app.css', 'dist/public/app.css');
console.log('client build done', result);
