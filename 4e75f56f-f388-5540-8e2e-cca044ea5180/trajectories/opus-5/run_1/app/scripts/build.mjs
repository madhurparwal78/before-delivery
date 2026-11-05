import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const out = new URL('dist/', root);

await rm(out, { recursive: true, force: true });
await mkdir(new URL('public/fonts/', out), { recursive: true });

await build({
  entryPoints: [new URL('src/server/index.ts', root).pathname],
  outfile: new URL('server.js', out).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [new URL('src/client/index.tsx', root).pathname],
  outfile: new URL('public/app.js', out).pathname,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'info',
});

await build({
  entryPoints: [new URL('src/client/styles.css', root).pathname],
  outfile: new URL('public/app.css', out).pathname,
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

await cp(new URL('assets/fonts/', root), new URL('public/fonts/', out), { recursive: true });
