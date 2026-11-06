import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const clientDir = join(root, 'dist', 'client');

function files(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files(full, found);
    else found.push(`/${relative(clientDir, full).split('\\').join('/')}`);
  }
  return found;
}

const precache = files(clientDir).filter((path) => path !== '/sw.js' && !path.endsWith('.map'));
const stamp = createHash('sha256')
  .update(precache.map((path) => `${path}:${readFileSync(join(clientDir, path)).length}`).join('|'))
  .digest('hex')
  .slice(0, 12);

await build({
  entryPoints: [join(root, 'src', 'sw', 'sw.ts')],
  outfile: join(clientDir, 'sw.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: {
    PRECACHE_FILES: JSON.stringify(precache),
    CACHE_NAME: JSON.stringify(`oddment-${stamp}`),
  },
});

await build({
  entryPoints: [join(root, 'src', 'server', 'index.ts')],
  outfile: join(root, 'dist', 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg'],
  banner: { js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);" },
});
