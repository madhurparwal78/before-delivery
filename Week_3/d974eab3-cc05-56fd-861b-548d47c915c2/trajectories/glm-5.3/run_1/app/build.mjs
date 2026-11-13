import { execFileSync } from 'node:child_process';
import { rmSync, cpSync, mkdirSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });

execFileSync('npx', ['esbuild', 'src/client/main.ts', '--bundle', '--format=iife', '--outfile=dist/public/js/vireo.js'], {
  stdio: 'inherit',
});

mkdirSync('dist/public', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });
