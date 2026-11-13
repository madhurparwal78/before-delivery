import { spawn } from 'node:child_process';

const suites = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['shared', 'api', 'live'];
let failed = false;
for (const suite of suites) {
  await new Promise((resolve) => {
    const child = spawn('node', ['--experimental-strip-types', '--no-warnings', '--import', './test/register-ts.mjs', '--experimental-strip-types', `test/${suite}.mts`], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code !== 0) failed = true;
      resolve();
    });
  });
}
process.exit(failed ? 1 : 0);
