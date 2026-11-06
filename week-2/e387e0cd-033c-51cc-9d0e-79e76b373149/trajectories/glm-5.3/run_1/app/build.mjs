import { build } from 'esbuild';
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist/server'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(root, 'dist/server/server.js'),
  external: ['node:*'],
  legalComments: 'none',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url); const __dirname = import.meta.dirname;" },
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  bundle: true,
  platform: 'browser',
  target: ['chrome128', 'firefox128', 'safari17'],
  format: 'esm',
  outfile: join(root, 'dist/server/static/client-main.mjs'),
  minify: true,
  legalComments: 'none',
});

cpSync(join(root, 'src/server/static'), join(root, 'dist/server/static'), { recursive: true });
console.log('build done');
