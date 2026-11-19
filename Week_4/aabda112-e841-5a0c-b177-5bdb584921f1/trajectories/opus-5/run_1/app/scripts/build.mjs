import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
rmSync(root + 'dist', { recursive: true, force: true });

execFileSync('node', [root + 'node_modules/typescript/bin/tsc', '-p', root + 'tsconfig.json'], {
  stdio: 'inherit',
});
execFileSync('node', [root + 'node_modules/typescript/bin/tsc', '-p', root + 'tsconfig.web.json'], {
  stdio: 'inherit',
});

await build({
  entryPoints: [root + 'src/web/main.tsx'],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  jsx: 'automatic',
  minify: true,
  outfile: root + 'dist/public/app.js',
  loader: { '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

mkdirSync(root + 'dist/public/fonts', { recursive: true });
const fonts = [
  ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2', 'jakarta-700.woff2'],
  ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2', 'jakarta-800.woff2'],
  ['@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2', 'dmsans-400.woff2'],
  ['@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2', 'dmsans-500.woff2'],
  ['@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2', 'dmsans-700.woff2'],
];
for (const [from, to] of fonts) {
  cpSync(root + 'node_modules/' + from, root + 'dist/public/fonts/' + to);
}
cpSync(root + 'static', root + 'dist/public', { recursive: true });

const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
writeFileSync(root + 'dist/public/version.txt', pkg.version + '\n');
console.log('build complete');
