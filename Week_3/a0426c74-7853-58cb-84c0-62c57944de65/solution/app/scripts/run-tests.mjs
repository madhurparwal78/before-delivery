// Bundles every src/**/*.test.ts with esbuild and runs them with node:test.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] ?? '';

function find(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return find(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const tests = find(join(root, 'src')).filter((path) => relative(root, path).includes(filter));
if (tests.length === 0) {
  console.log('no tests');
  process.exit(0);
}
const out = mkdtempSync(join(root, 'node_modules', '.plotfold-tests-'));
const files = tests.map((path) => join(out, relative(join(root, 'src'), path).replaceAll('/', '_').replace(/\.ts$/, '.mjs')));
await Promise.all(tests.map((entry, i) => build({
  entryPoints: [entry], outfile: files[i], bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'warning',
})));
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
rmSync(out, { recursive: true, force: true });
process.exit(run.status ?? 1);
