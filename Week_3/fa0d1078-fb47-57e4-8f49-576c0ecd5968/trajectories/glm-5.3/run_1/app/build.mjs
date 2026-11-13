import pkg from 'esbuild';
import { mkdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const { build } = pkg;
const root = process.cwd();
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'server'), { recursive: true });
mkdirSync(join(dist, 'client'), { recursive: true });

// The server bundle: one file, platform Node, with all server and shared code.
await build({
  entryPoints: [join(root, 'server', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(dist, 'server', 'main.js'),
  packages: 'external',
  logLevel: 'error',
});

// The client bundle: one module for the whole app.
await build({
  entryPoints: [join(root, 'client', 'app.ts')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: join(dist, 'client', 'app.js'),
  logLevel: 'error',
  minify: true,
  legalComments: 'none',
});

// Static assets shipped with the client.
cpSync(join(root, 'client', 'index.html'), join(dist, 'client', 'index.html'));
cpSync(join(root, 'client', 'styles.css'), join(dist, 'client', 'app.css'));
cpSync(join(root, 'fonts'), join(dist, 'client', 'fonts'), { recursive: true });

console.log('built');
