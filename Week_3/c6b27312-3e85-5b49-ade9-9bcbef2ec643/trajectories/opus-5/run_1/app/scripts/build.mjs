import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
});

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json'], {
  stdio: 'inherit',
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'dist/public/app.js',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

mkdirSync('dist/public/fonts', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });
for (const [from, to] of [
  [
    'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
    'dist/public/fonts/stack-sans-text.woff2',
  ],
  [
    'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2',
    'dist/public/fonts/stack-sans-headline.woff2',
  ],
]) {
  cpSync(from, to);
}

console.log('build complete');
