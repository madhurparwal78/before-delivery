import { rm, cp } from 'node:fs/promises';
import { build } from 'esbuild';

const outdir = 'dist';
// Clean only the client outputs; tsc has already compiled the server into dist.
await rm(`${outdir}/fonts`, { recursive: true, force: true });
await rm(`${outdir}/client.js`, { force: true });
await rm(`${outdir}/styles.css`, { force: true });
await rm(`${outdir}/index.html`, { force: true });
await cp('src/client/fonts', `${outdir}/fonts`, { recursive: true });
await cp('src/client/styles.css', `${outdir}/styles.css`);
await cp('src/client/index.html', `${outdir}/index.html`);

await build({
  entryPoints: { client: 'src/client/main.ts' },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  metafile: false,
});

console.log('client built to dist/client.js');
