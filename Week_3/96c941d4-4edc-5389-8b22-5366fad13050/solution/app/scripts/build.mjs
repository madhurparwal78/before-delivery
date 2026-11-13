import { build } from 'esbuild';
import { mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(dist, 'server/main.js'),
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  outfile: path.join(dist, 'public/app.js'),
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

const publicSrc = path.join(root, 'public');
for (const entry of await readdir(publicSrc)) {
  await cp(path.join(publicSrc, entry), path.join(dist, 'public', entry), { recursive: true });
}

if (!existsSync(path.join(dist, 'public/fonts'))) {
  throw new Error('bundled fonts are missing from public/fonts');
}
console.log('build complete');
