import { build } from 'esbuild';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('./', import.meta.url).pathname;
const out = `${root}dist`;

execFileSync('node', [`${root}node_modules/typescript/bin/tsc`, '-p', 'tsconfig.json', '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
});

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/public/fonts`, { recursive: true });

await build({
  entryPoints: [`${root}src/server/index.ts`],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  loader: { '.svg': 'text', '.sql': 'text' },
});

await build({
  entryPoints: [`${root}src/client/main.ts`],
  outfile: `${out}/public/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  sourcemap: false,
  minify: true,
  loader: { '.svg': 'text' },
});

await build({
  entryPoints: [`${root}src/client/styles.css`],
  outfile: `${out}/public/app.css`,
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
});

for (const weight of [400, 700, 900]) {
  await cp(
    `${root}node_modules/@fontsource/chivo/files/chivo-latin-${weight}-normal.woff2`,
    `${out}/public/fonts/chivo-latin-${weight}-normal.woff2`,
  );
}

const notices = await readFile(`${root}THIRD_PARTY_NOTICES.md`, 'utf8');
if (!notices.includes('Chivo')) throw new Error('THIRD_PARTY_NOTICES.md is incomplete');
console.log('build complete');
