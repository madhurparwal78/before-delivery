import { build } from 'esbuild';
import { mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [join(root, 'web/src/main.ts'), join(root, 'web/src/share.ts')],
  bundle: true,
  format: 'esm',
  outdir: join(root, 'web/dist'),
  outbase: join(root, 'web/src'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(src)) {
    const from = join(src, f);
    const to = join(dest, f);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

mkdirSync(join(root, 'web/dist'), { recursive: true });
copyDir(join(root, 'web/public'), join(root, 'web/dist'));
console.log('build done', result.errors.length, 'errors');
