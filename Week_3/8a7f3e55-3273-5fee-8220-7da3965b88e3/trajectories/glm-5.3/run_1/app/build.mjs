import { build } from 'esbuild';
import { mkdirSync, cpSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist-server', { recursive: true });
mkdirSync('dist', { recursive: true });

execFileSync(process.platform === 'win32' ? 'tsc.cmd' : 'tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: 'dist/assets/app.js',
});

copyFileSync('src/client/index.html', 'dist/index.html');
copyFileSync('src/client/styles.css', 'dist/assets/app.css');
cpSync('src/client/fonts', 'dist/fonts', { recursive: true });
cpSync('src/server/schema.sql', 'dist-server/server/schema.sql');
console.log('build complete');
