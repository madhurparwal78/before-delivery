import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = process.env.OUT_DIR ?? 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/client/assets`, { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: { app: 'src/client/main.tsx', embed: 'src/client/embed.tsx' },
  outdir: `${out}/client/assets`,
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

await cp('src/client/index.html', `${out}/client/index.html`);
await cp('src/client/embed.html', `${out}/client/embed.html`);
