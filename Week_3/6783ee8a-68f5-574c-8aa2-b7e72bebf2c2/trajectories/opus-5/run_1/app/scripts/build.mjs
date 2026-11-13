import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = `${root}node_modules/typescript/bin/tsc`;

rmSync(`${root}dist`, { recursive: true, force: true });

execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.client.json'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.kernel.json'], { cwd: root, stdio: 'inherit' });

await build({
  entryPoints: [`${root}src/client/main.tsx`],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  outfile: `${root}dist/public/app.js`,
  define: { 'process.env.NODE_ENV': '"production"' },
});

await build({
  entryPoints: [`${root}src/kernel/worker.ts`],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  outfile: `${root}dist/public/kernel.js`,
});

await build({
  entryPoints: [`${root}src/client/styles.css`],
  bundle: true,
  minify: true,
  sourcemap: false,
  outfile: `${root}dist/public/app.css`,
  external: ['/fonts/*'],
});

mkdirSync(`${root}dist/public/fonts`, { recursive: true });
cpSync(`${root}public/fonts`, `${root}dist/public/fonts`, { recursive: true });
cpSync(`${root}src/client/index.html`, `${root}dist/public/index.html`);
chmodSync(`${root}dist/public/index.html`, 0o644);
