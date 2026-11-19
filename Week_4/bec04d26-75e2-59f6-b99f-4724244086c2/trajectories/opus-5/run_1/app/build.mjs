import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'public', 'fonts'), { recursive: true });

execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.client.json'],
  { cwd: root, stdio: 'inherit' },
);

await esbuild.build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'public', 'app.js'),
  logLevel: 'info',
});

cpSync(join(root, 'src', 'assets', 'index.html'), join(dist, 'public', 'index.html'));
cpSync(join(root, 'src', 'assets', 'styles.css'), join(dist, 'public', 'styles.css'));
cpSync(join(root, 'src', 'assets', 'fonts'), join(dist, 'public', 'fonts'), { recursive: true });
cpSync(join(root, 'src', 'assets', 'fonts'), join(dist, 'server', 'assets', 'fonts'), {
  recursive: true,
});

console.log('build complete');
