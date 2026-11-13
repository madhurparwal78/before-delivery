import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

const run = (args) => execFileSync('node', args, { cwd: root, stdio: 'inherit' });
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

rmSync(dist, { recursive: true, force: true });

run([tsc, '-p', 'tsconfig.server.json']);
run([tsc, '-p', 'tsconfig.client.json']);

mkdirSync(join(publicDir, 'fonts'), { recursive: true });
copyFileSync(join(root, 'src', 'server', 'schema.sql'), join(dist, 'server', 'schema.sql'));

for (const file of ['work-sans-latin-400-normal.woff2', 'work-sans-latin-600-normal.woff2']) {
  copyFileSync(join(root, 'node_modules', '@fontsource', 'work-sans', 'files', file), join(publicDir, 'fonts', file));
}

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  loader: { '.svg': 'text' },
  outfile: join(publicDir, 'app.js'),
});

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'styles.css')],
  bundle: true,
  minify: true,
  sourcemap: false,
  external: ['/fonts/*'],
  outfile: join(publicDir, 'app.css'),
});
