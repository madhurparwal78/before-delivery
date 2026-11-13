// Bundles a TypeScript entry point and runs it, for development checks.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const entry = process.argv[2];
const out = new URL('../node_modules/.run-ts.bundle.mjs', import.meta.url).pathname;
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  loader: { '.txt': 'text' },
  outfile: out,
});
const result = spawnSync(process.execPath, [out, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
