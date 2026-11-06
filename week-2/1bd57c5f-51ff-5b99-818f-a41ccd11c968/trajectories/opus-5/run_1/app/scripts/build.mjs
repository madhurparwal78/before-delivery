import { build } from 'esbuild';
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'public', 'assets'), { recursive: true });
await mkdir(join(dist, 'public', 'fonts'), { recursive: true });
await mkdir(join(dist, 'assets', 'plans'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(dist, 'server/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/web/main.ts')],
  outfile: join(dist, 'public/assets/app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/web/sw.ts')],
  outfile: join(dist, 'public/sw.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/web/styles.css')],
  outfile: join(dist, 'public/assets/app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

await cp(join(root, 'assets/fonts'), join(dist, 'public/fonts'), { recursive: true });
await cp(join(root, 'assets/plans'), join(dist, 'assets/plans'), { recursive: true });
await cp(join(root, 'src/web/index.html'), join(dist, 'public/index.html'));

const names = await readdir(join(dist, 'public/fonts'));
if (names.length === 0) throw new Error('no fonts were bundled');
