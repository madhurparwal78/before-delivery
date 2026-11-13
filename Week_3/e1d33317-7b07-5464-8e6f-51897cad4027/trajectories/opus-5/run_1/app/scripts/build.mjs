import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const root = new URL('..', import.meta.url);
const out = new URL('dist/', root);

await rm(out, { recursive: true, force: true });
await mkdir(new URL('server/', out), { recursive: true });

await esbuild({
  entryPoints: [new URL('src/server/index.ts', root).pathname],
  outfile: new URL('server/index.js', out).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

await esbuild({
  entryPoints: [new URL('src/client/worklet/clock.ts', root).pathname],
  outfile: new URL('client/worklet/clock.js', out).pathname,
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  logLevel: 'info',
});

await viteBuild({ configFile: new URL('vite.config.ts', root).pathname });

await cp(new URL('assets/fonts/', root), new URL('assets/fonts/', out), { recursive: true });
await cp(new URL('assets/fonts/', root), new URL('client/fonts/', out), { recursive: true });

execFileSync('node', [new URL('notices.mjs', import.meta.url).pathname], { stdio: 'inherit' });
