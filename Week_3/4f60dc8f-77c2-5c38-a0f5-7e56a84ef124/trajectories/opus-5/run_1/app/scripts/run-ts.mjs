import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = process.argv[2];
if (!entry) throw new Error('usage: node scripts/run-ts.mjs <entry.ts>');

const dir = await mkdtemp(join(process.cwd(), '.tmp-run-'));
const outfile = join(dir, 'entry.mjs');
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning',
});
try {
  await import(outfile);
} finally {
  await rm(dir, { recursive: true, force: true });
}
