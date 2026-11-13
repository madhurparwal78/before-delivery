import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const result = await build({
  entryPoints: [`${root}src/ui/pages.ts`],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: `${root}public/assets/app.js`,
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
});
console.log(`bundled app.js (${result.metafile ? '' : ''})`);
