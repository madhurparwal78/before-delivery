// Bundles the TypeScript frontend and copies the HTML shell and fonts into
// web/dist, which the Go binary embeds.

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = 'web/dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Keeps the go:embed pattern satisfied in a checkout that has not been built.
writeFileSync(`${out}/.gitkeep`, '');

const shared = {
  bundle: true,
  minify: true,
  logLevel: 'info',
  loader: { '.woff2': 'file' },
};

await build({
  ...shared,
  entryPoints: ['web/src/main.ts'],
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: `${out}/app.js`,
});

await build({
  ...shared,
  entryPoints: ['web/src/styles.css'],
  outfile: `${out}/app.css`,
});

cpSync('web/public', out, { recursive: true });
