import { spawnSync } from 'node:child_process';

const suites = ['test/api.test.mjs', 'test/browser.test.mjs'];
let failed = false;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync('node', [suite], { stdio: 'inherit', cwd: '/app' });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
