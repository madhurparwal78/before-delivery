import { build } from 'esbuild';
import { mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
rmSync('dist/client', { recursive: true, force: true });
mkdirSync('dist/client', { recursive: true });

const shared = {
  bundle: true,
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};

const nodeBanner = {
  js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
};

await build({ ...shared, banner: nodeBanner, entryPoints: ['src/server/main.ts'], outfile: 'dist/server/main.js' });
await build({
  ...shared,
  platform: 'browser',
  target: 'es2022',
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/client/main.js',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
cpSync('static', 'dist/client', { recursive: true });
writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }));
console.log('build complete');
