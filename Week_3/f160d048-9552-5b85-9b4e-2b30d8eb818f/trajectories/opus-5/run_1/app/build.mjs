import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = new URL('.', import.meta.url).pathname;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

rmSync(`${root}dist`, { recursive: true, force: true });

run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json']);

const publicDir = `${root}dist/public`;
mkdirSync(`${publicDir}/fonts`, { recursive: true });

await esbuild.build({
  entryPoints: [`${root}src/client/main.ts`],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  outfile: `${publicDir}/app.js`,
  legalComments: 'none',
});

await esbuild.build({
  entryPoints: [`${root}src/client/app.css`],
  bundle: true,
  external: ['/fonts/*'],
  minify: true,
  outfile: `${publicDir}/app.css`,
});

const fontDir = `${require.resolve('@fontsource/literata/package.json').replace(/package\.json$/, '')}files`;
for (const name of [
  'literata-latin-400-normal.woff2',
  'literata-latin-500-normal.woff2',
  'literata-latin-600-normal.woff2',
  'literata-latin-700-normal.woff2',
  'literata-latin-400-italic.woff2',
]) {
  cpSync(`${fontDir}/${name}`, `${publicDir}/fonts/${name}`);
}

const html = readFileSync(`${root}src/client/index.html`, 'utf8');
writeFileSync(`${publicDir}/index.html`, html);
cpSync(`${root}src/server/db/schema.sql`, `${root}dist/server/db/schema.sql`);

console.log('build complete');
