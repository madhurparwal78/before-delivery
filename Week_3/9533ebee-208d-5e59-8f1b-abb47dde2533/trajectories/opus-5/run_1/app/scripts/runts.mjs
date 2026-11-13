// Bundles a TypeScript entry with the server's loader settings and runs it.
// Used to exercise server modules directly during development.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const entry = process.argv[2];
if (entry === undefined) {
  process.stderr.write('usage: node scripts/runts.mjs <entry.ts>\n');
  process.exit(2);
}
// Output inside the project so bundled externals resolve from node_modules.
const outDir = join(dirname(import.meta.dirname), '.tmp');
await mkdir(outDir, { recursive: true });
const outfile = join(outDir, 'entry.mjs');
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  loader: { '.sql': 'text' },
  logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
