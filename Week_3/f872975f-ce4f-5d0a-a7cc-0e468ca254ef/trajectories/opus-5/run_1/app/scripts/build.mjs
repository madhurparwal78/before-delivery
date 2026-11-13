import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: process.cwd() });

rmSync('dist', { recursive: true, force: true });

run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json']);

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'dist/public/app.js',
  sourcemap: false,
  minify: true,
  legalComments: 'none'
});

mkdirSync('dist/public', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });
cpSync('src/client/index.html', 'dist/public/index.html');
cpSync('src/client/styles.css', 'dist/public/styles.css');
cpSync('src/server/db/schema.sql', 'dist/server/db/schema.sql');
