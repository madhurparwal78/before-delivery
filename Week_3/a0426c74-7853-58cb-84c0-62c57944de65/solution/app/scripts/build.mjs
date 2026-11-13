import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'public', 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});

await build({
  entryPoints: { app: join(root, 'src/client/main.tsx') },
  outdir: join(dist, 'public'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // fonts are served from /fonts by the server, not bundled
  external: ['/fonts/*'],
  logLevel: 'warning',
});

await cp(join(root, 'src/client/index.html'), join(dist, 'public', 'index.html'));
await cp(join(root, 'assets/fonts'), join(dist, 'public', 'fonts'), {
  recursive: true,
  filter: (source) => !source.endsWith('.txt'),
});
