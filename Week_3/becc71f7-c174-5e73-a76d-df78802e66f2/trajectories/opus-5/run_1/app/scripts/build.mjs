import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'public'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: false,
  packages: 'external',
  banner: {
    js: "import { createRequire as __nodeRequire } from 'node:module'; const require = __nodeRequire(import.meta.url);",
  },
});

await build({
  entryPoints: [join(root, 'src/client/main.tsx')],
  outfile: join(dist, 'public/app.js'),
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
});

await build({
  entryPoints: [join(root, 'styles/app.css')],
  outfile: join(dist, 'public/app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
});

await cp(join(root, 'public'), join(dist, 'public'), { recursive: true });

console.log('build complete');
