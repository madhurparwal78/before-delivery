import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: process.cwd() });

rmSync('dist', { recursive: true, force: true });

run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json']);
run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.sw.json']);

mkdirSync('dist/public', { recursive: true });

await esbuild.build({
  entryPoints: {
    owner: 'src/client/owner/main.ts',
    link: 'src/client/link/main.ts',
  },
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari16'],
  outdir: 'dist/public',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

await esbuild.build({
  entryPoints: { 'inspector-sw': 'src/client/inspector/service-worker.ts' },
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari16'],
  outdir: 'dist/public',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

cpSync('public', 'dist/public', { recursive: true });

run('node', ['scripts/notices.mjs']);
