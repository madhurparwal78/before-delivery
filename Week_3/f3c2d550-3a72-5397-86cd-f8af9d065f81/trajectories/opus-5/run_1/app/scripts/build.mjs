import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);

const runtimeDependencies = Object.keys(
  require(join(root, 'package.json')).dependencies ?? {},
);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'public'), { recursive: true });

// 1. Draw the stand-in photographs and bundle the landing demo stops.
await build({
  entryPoints: [join(root, 'src', 'build', 'prepare.ts')],
  outfile: join(root, '.build', 'prepare.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: runtimeDependencies,
  logLevel: 'warning',
});
execFileSync(process.execPath, [join(root, '.build', 'prepare.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

// 2. The browser bundle and its stylesheet.
await build({
  entryPoints: [join(root, 'src', 'web', 'main.ts')],
  outfile: join(dist, 'public', 'assets', 'app.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  loader: { '.svg': 'text' },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src', 'web', 'app.css')],
  outfile: join(dist, 'public', 'assets', 'app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'warning',
});

// 3. The server bundle and the image worker it runs pixel work on.
await build({
  entryPoints: {
    index: join(root, 'src', 'server', 'index.ts'),
    'image-worker': join(root, 'src', 'server', 'imageWorker.ts'),
  },
  outdir: join(dist, 'server'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: runtimeDependencies,
  logLevel: 'warning',
});

// 4. Static files the browser is allowed to see.
cpSync(join(root, 'public'), join(dist, 'public'), { recursive: true });

rmSync(join(root, '.build'), { recursive: true, force: true });
process.stdout.write('build complete\n');
