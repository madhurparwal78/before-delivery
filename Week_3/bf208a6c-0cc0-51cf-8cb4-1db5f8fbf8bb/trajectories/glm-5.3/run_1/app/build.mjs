import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);
rmSync(`${root}/dist`, { recursive: true, force: true });

execFileSync('npx', ['tsc', '-p', `${root}/tsconfig.build.json`], { stdio: 'inherit', cwd: root });
execFileSync('npx', ['tsc', '-p', `${root}/tsconfig.client.json`, '--noEmit'], { stdio: 'inherit', cwd: root });

mkdirSync(`${root}/dist/static`, { recursive: true });
await build({
  root: `${root}/src/client`,
  base: '/',
  build: {
    outDir: `${root}/dist/static`,
    emptyOutDir: true,
    rollupOptions: {
      input: `${root}/src/client/index.html`,
    },
  },
});
cpSync(`${root}/public/fonts`, `${root}/dist/static/fonts`, { recursive: true });
console.log('build done');
