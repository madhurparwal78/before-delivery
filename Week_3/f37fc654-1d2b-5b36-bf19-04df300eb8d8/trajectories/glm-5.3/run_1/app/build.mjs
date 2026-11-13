// Client build: tsc emits per-file ES modules (native import support in browsers),
// then fonts and static assets are copied alongside them.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const dist = resolve(root, 'dist', 'client');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const tsc = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules', 'typescript', 'lib', 'tsc.js'), '-p', 'tsconfig.build.client.json'],
  { cwd: root, stdio: 'inherit' },
);
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

// Fonts land beside the emitted modules.
cpSync(resolve(root, 'client', 'fonts'), resolve(dist, 'assets', 'fonts'), { recursive: true });

// Static shell.
const html = readFileSync(resolve(root, 'public', 'index.html'), 'utf8');
writeFileSync(resolve(dist, 'index.html'), html);
cpSync(resolve(root, 'public', 'style.css'), resolve(dist, 'style.css'));
cpSync(resolve(root, 'public', 'favicon.svg'), resolve(dist, 'favicon.svg'));

const files = readdirSync(resolve(dist, 'assets'), { recursive: true });
console.log(`client build complete: ${files.length} files`);
