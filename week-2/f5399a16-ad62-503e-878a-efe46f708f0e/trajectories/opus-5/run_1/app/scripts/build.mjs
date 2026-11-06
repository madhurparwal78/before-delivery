import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/public/', import.meta.url), {
  recursive: true,
});

await build({
  entryPoints: [new URL('../src/server/main.ts', import.meta.url).pathname],
  outfile: new URL('../dist/server.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg', 'busboy'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

await build({
  entryPoints: [new URL('../src/client/main.ts', import.meta.url).pathname],
  outfile: new URL('../dist/public/app.js', import.meta.url).pathname,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  logLevel: 'info',
});

await build({
  entryPoints: [new URL('../src/client/app.css', import.meta.url).pathname],
  outfile: new URL('../dist/public/app.css', import.meta.url).pathname,
  bundle: true,
  logLevel: 'info',
});
