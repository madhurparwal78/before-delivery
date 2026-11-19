import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.tsx'],
  outfile: 'dist/assets/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await cp('public', 'dist/public', { recursive: true });

const css = await readFile('src/client/styles.css', 'utf8');
await writeFile('dist/assets/app.css', css);
