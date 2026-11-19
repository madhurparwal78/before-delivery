import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = '/app';

const tsc = `${root}/node_modules/.bin/tsc`;
const esb = `${root}/node_modules/.bin/esbuild`;

try {
  execFileSync(tsc, ['--noEmit', '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
  mkdirSync(`${root}/dist/client/fonts`, { recursive: true });
  execFileSync(esb, ['--bundle', '--format=cjs', '--platform=node', '--target=es2022', '--outfile=dist/server.cjs', '--external:sharp', 'src/server/main.ts'], { cwd: root, stdio: 'inherit' });
  execFileSync(esb, ['--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--outfile=dist/client/main.js', 'src/client/index.ts'], { cwd: root, stdio: 'inherit' });
} catch (err) {
  if (err && typeof err.status === 'number') process.exit(err.status);
  throw err;
}
console.log('build ok');
