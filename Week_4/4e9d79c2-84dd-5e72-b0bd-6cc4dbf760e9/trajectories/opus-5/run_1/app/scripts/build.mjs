import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'public', 'fonts'), { recursive: true });

for (const project of ['tsconfig.json', 'tsconfig.client.json']) {
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], {
    cwd: root,
    stdio: 'inherit',
  });
}

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: join(out, 'public', 'app.js'),
  minify: true,
  legalComments: 'none',
});

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'service-worker.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: join(out, 'public', 'service-worker.js'),
  minify: true,
  legalComments: 'none',
});

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'styles.css')],
  bundle: true,
  outfile: join(out, 'public', 'app.css'),
  minify: true,
  external: ['/fonts/*'],
});

const fonts = [
  ['@fontsource/poppins/files/poppins-latin-400-normal.woff2', 'poppins-400.woff2'],
  ['@fontsource/poppins/files/poppins-latin-600-normal.woff2', 'poppins-600.woff2'],
  ['@fontsource/poppins/files/poppins-latin-700-normal.woff2', 'poppins-700.woff2'],
  ['@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2', 'noto-sans-400.woff2'],
  ['@fontsource/noto-sans/files/noto-sans-latin-600-normal.woff2', 'noto-sans-600.woff2'],
  ['@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-latin-400-normal.woff2', 'noto-nastaliq-latin-400.woff2'],
  ['@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2', 'noto-nastaliq-400.woff2'],
];
for (const [from, to] of fonts) {
  const source = join(root, 'node_modules', from);
  if (!existsSync(source)) throw new Error(`missing font file ${from}`);
  cpSync(source, join(out, 'public', 'fonts', to));
}

execFileSync(process.execPath, [join(root, 'scripts', 'notices.mjs')], { cwd: root, stdio: 'inherit' });
