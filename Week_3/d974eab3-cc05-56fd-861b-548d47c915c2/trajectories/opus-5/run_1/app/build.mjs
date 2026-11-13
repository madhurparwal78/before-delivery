import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {
  stdio: 'inherit',
});

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server/main.js',
  external: ['pg-native', 'cloudflare:sockets'],
  // `pg` ships CommonJS, so the bundle needs a `require` of its own.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  format: 'iife',
  minify: true,
  outfile: 'dist/public/assets/client.js',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/styles/site.css'],
  bundle: true,
  minify: true,
  external: ['/assets/*'],
  outfile: 'dist/public/assets/site.css',
  logLevel: 'info',
});

await cp('public/fonts', 'dist/public/assets/fonts', { recursive: true });
