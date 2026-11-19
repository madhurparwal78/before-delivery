import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Type-check and emit the server with tsc (CommonJS, no extensions needed).
execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
cpSync('src/server/schema.sql', 'dist/server/schema.sql');

if (existsSync('src/browser/main.ts')) {
  mkdirSync('public/assets', { recursive: true });
  await build({
    entryPoints: ['src/browser/main.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'firefox120', 'safari17'],
    outfile: 'public/assets/app.js',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  if (existsSync('src/browser/styles.css')) {
    cpSync('src/browser/styles.css', 'public/assets/app.css');
  }
  console.log('browser built');
}
console.log('build done');
