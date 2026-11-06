import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets/fonts', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  external: ['pg', 'pg-native', 'argon2'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/public/app.js',
  minify: true,
});

const fonts = await readFile('src/client/fonts.css', 'utf-8');
const styles = await readFile('src/client/styles.css', 'utf-8');
await writeFile('dist/public/styles.css', fonts + styles);
await cp('src/client/index.html', 'dist/public/index.html');
await cp('assets/fonts', 'dist/public/assets/fonts', { recursive: true });
console.log('built');
