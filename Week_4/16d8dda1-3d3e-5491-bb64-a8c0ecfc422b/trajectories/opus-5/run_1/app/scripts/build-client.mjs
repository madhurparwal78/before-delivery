import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outDir = 'dist/public';

await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/assets`, { recursive: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: `${outDir}/assets/app.js`
});

await cp('src/client/index.html', `${outDir}/index.html`);
await cp('src/client/app.css', `${outDir}/assets/app.css`);
