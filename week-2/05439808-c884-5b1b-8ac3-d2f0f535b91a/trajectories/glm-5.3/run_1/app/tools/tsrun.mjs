import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const entry = process.argv[2];
const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const dir = mkdtempSync(join(tmpdir(), 'tsrun-'));
const file = join(dir, 'bundle.mjs');
writeFileSync(file, result.outputFiles[0].text);
await import(pathToFileURL(file).href);
