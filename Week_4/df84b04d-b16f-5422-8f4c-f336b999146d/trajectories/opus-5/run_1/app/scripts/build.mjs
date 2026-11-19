import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await rm(`${root}build`, { recursive: true, force: true });
await mkdir(`${root}build/public/fonts`, { recursive: true });

await build({
  entryPoints: [`${root}src/server/index.ts`],
  outfile: `${root}build/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"
  }
});

await build({
  entryPoints: [`${root}src/client/main.ts`],
  outfile: `${root}build/public/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  logLevel: 'info'
});

await build({
  entryPoints: [`${root}src/client/styles.css`],
  outfile: `${root}build/public/app.css`,
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info'
});

await cp(`${root}public/fonts`, `${root}build/public/fonts`, { recursive: true });
await cp(`${root}src/client/index.html`, `${root}build/public/index.html`);
await cp(`${root}public/favicon.svg`, `${root}build/public/favicon.svg`);
