import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

execFileSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '-p', 'tsconfig.client.json'], {
  cwd: root,
  stdio: 'inherit',
});

rmSync(`${root}public/assets`, { recursive: true, force: true });
mkdirSync(`${root}public/assets/fonts`, { recursive: true });

const fonts = [
  ['@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-400-normal.woff2'],
  ['@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-600-normal.woff2'],
  ['@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-700-normal.woff2'],
  ['@fontsource/schibsted-grotesk', 'schibsted-grotesk-latin-400-normal.woff2'],
  ['@fontsource/schibsted-grotesk', 'schibsted-grotesk-latin-500-normal.woff2'],
  ['@fontsource/schibsted-grotesk', 'schibsted-grotesk-latin-700-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff2'],
];
for (const [pkg, file] of fonts) {
  cpSync(`${root}node_modules/${pkg}/files/${file}`, `${root}public/assets/fonts/${file}`);
}

await build({
  entryPoints: [`${root}src/client/main.ts`],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: `${root}public/assets/app.js`,
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: [`${root}src/client/styles.css`],
  bundle: true,
  outfile: `${root}public/assets/app.css`,
  external: ['/assets/fonts/*'],
  minify: true,
  logLevel: 'warning',
});
