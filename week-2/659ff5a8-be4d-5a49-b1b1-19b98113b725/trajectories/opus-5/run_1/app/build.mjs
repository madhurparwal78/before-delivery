import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
});
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json'], {
  stdio: 'inherit',
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'dist/public/assets/app.js',
  legalComments: 'none',
});

await build({
  entryPoints: ['src/client/styles.css'],
  bundle: true,
  minify: true,
  loader: { '.woff2': 'empty' },
  external: ['/assets/fonts/*'],
  outfile: 'dist/public/assets/app.css',
});

await cp('src/client/index.html', 'dist/public/index.html');
await cp('assets/fonts', 'dist/public/assets/fonts', { recursive: true });
await cp('src/server/db/schema.sql', 'dist/server/db/schema.sql');

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/public/assets/.version', `${pkg.name}@${pkg.version}\n`);
