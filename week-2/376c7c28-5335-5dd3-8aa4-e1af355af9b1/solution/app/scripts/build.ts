import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const publicOut = join(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(publicOut, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg', 'pg-native'],
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(publicOut, 'assets/app.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/app.css')],
  outfile: join(publicOut, 'assets/app.css'),
  bundle: true,
  minify: true,
  loader: { '.woff2': 'file' },
  logLevel: 'info',
});

await cp(join(root, 'public'), publicOut, { recursive: true });
await mkdir(dirname(join(publicOut, 'index.html')), { recursive: true });
await cp(join(root, 'src/client/index.html'), join(publicOut, 'index.html'));

process.stdout.write('kiln desk built\n');
