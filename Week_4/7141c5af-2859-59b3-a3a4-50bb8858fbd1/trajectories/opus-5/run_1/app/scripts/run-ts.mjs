// Bundles a TypeScript entry point and runs it, for verification scripts.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';

import { join } from 'node:path';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs <entry.ts> [args...]');
  process.exit(2);
}
const dir = await mkdtemp(join(process.cwd(), '.runts-'));
const out = join(dir, 'main.mjs');
await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});
const child = spawn(process.execPath, [out, ...process.argv.slice(3)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
