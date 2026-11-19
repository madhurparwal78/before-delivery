import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const pub = join(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(pub, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/server.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg', 'ws'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(pub, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'info',
});

await cp(join(root, 'src/client/app.css'), join(pub, 'app.css'));
await cp(join(root, 'assets'), join(pub, 'assets'), { recursive: true });
await cp(join(root, 'src/server/schema.sql'), join(dist, 'schema.sql'));

const html = await readFile(join(root, 'src/client/index.html'), 'utf8');
await writeFile(join(pub, 'index.html'), html);
