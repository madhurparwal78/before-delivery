import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});

await build({
  entryPoints: ['src/web/main.ts'],
  outfile: 'dist/public/assets/app.js',
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  minify: true,
});

await build({
  entryPoints: ['src/web/styles.css'],
  outfile: 'dist/public/assets/app.css',
  bundle: true,
  target: ['chrome120'],
  sourcemap: false,
  legalComments: 'none',
  minify: true,
  // `/assets/...` references are served by the app, not bundled.
  external: ['/assets/*'],
});

await cp('assets', 'dist/public/assets', { recursive: true });
