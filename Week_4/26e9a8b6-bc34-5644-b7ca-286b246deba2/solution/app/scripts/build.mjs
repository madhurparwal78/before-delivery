import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'public', 'assets'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg', 'ws'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

await build({
  entryPoints: { app: join(root, 'src/client/main.ts') },
  outdir: join(dist, 'public', 'assets'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  loader: { '.css': 'css' },
  external: ['/assets/*'],
});

await build({
  entryPoints: [join(root, 'src/server/samples-cli.ts')],
  outfile: join(dist, 'samples-cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
});
execFileSync(process.execPath, [join(dist, 'samples-cli.mjs'), join(dist, 'samples')], { stdio: 'inherit' });
rmSync(join(dist, 'samples-cli.mjs'));

cpSync(join(root, 'assets', 'fonts'), join(dist, 'public', 'assets', 'fonts'), { recursive: true, filter: (source) => !source.endsWith('.txt') });
