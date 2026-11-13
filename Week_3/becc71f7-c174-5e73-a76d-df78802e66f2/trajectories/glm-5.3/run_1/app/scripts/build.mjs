import { build } from 'esbuild';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const outdir = 'dist';
mkdirSync(outdir, { recursive: true });

// Server: bundled ESM, with node builtins external and CommonJS deps required.
await build({
  entryPoints: ['src/server/start.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: `${outdir}/server/start.js`,
  external: ['pg', 'pg-*', 'nodemailer', '@aws-sdk/*', 'pngjs', '@jsquash/*'],
  banner: {
    js: [
      "import { createRequire as __ourletCreateRequire } from 'node:module';",
      "if (typeof globalThis.require === 'undefined') { globalThis.require = __ourletCreateRequire(import.meta.url); }",
    ].join('\n'),
  },
  legalComments: 'inline',
});

// Client: bundle to a single ESM script for the browser.
await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: `${outdir}/client/main.js`,
  legalComments: 'none',
  minify: false,
});

// Client CSS: copy through esbuild's css handling from a single entry.
await build({
  entryPoints: ['src/client/main.css'],
  bundle: true,
  outfile: `${outdir}/client/main.css`,
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  legalComments: 'none',
});

console.log('build complete');
