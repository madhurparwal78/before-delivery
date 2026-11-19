import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

rmSync(join(root, 'dist'), { recursive: true, force: true });

run('npx', ['tsc', '-p', 'tsconfig.json']);
run('npx', ['tsc', '-p', 'tsconfig.client.json']);

mkdirSync(join(root, 'dist/public'), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'src/client/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  outfile: join(root, 'dist/public/app.js'),
  logLevel: 'info',
});

cpSync(join(root, 'src/client/index.html'), join(root, 'dist/public/index.html'));
cpSync(join(root, 'src/client/styles.css'), join(root, 'dist/public/styles.css'));
cpSync(join(root, 'src/server/demo-seed.json'), join(root, 'dist/server/demo-seed.json'));
