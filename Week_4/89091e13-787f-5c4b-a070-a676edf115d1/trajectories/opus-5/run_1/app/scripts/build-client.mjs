import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/client', { recursive: true });
await mkdir('dist/server', { recursive: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outfile: 'dist/client/app.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await copyFile('src/client/index.html', 'dist/client/index.html');
await copyFile('src/client/styles.css', 'dist/client/styles.css');
await copyFile('src/server/schema.sql', 'dist/server/schema.sql');
