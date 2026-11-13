// Bundles a TypeScript entry point with esbuild and runs it in this process.
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs <entry.ts>');
  process.exit(1);
}

// Inside the repository, so a dynamic import of a shipped package still resolves.
const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), '.ts-run');
await mkdir(dir, { recursive: true });
const outfile = join(dir, 'entry.mjs');
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: {
    js: "import { createRequire as __nodeRequire } from 'node:module'; const require = __nodeRequire(import.meta.url);",
  },
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
