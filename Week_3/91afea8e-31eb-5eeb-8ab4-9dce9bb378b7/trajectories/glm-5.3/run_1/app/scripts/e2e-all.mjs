// Runs every browser journey suite in sequence.
import { spawnSync } from "node:child_process";

const suites = ["e2e.mjs", "e2e-dp05.mjs", "e2e-dp29.mjs", "e2e-seller.mjs"];
let failed = 0;
for (const suite of suites) {
  console.log(`\n===== ${suite} =====`);
  const res = spawnSync("node", [`scripts/${suite}`], { stdio: "inherit", cwd: process.cwd() });
  if (res.status !== 0) failed += 1;
}
console.log(`\n${failed === 0 ? "ALL SUITES PASSED" : `${failed} SUITE(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
