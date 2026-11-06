// Builds and runs one throwaway script against the server modules, for local checks.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const entry = resolve(process.cwd(), process.argv[2]);
const out = resolve(process.cwd(), '.scratch-build.mjs');
await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module';const require=__cr(import.meta.url);" },
});
const child = spawn(process.execPath, [out, ...process.argv.slice(3)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
