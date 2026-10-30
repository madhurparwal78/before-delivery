import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist/web';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('web', out, { recursive: true });
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  sourcemap: false,
  outfile: `${out}/app.js`,
});
await mkdir('dist/server/db', { recursive: true });
await cp('src/server/db/schema.sql', 'dist/server/db/schema.sql');
