import { spawnSync } from 'node:child_process';
import path from 'node:path';
const bin = path.join(import.meta.dirname, 'typescript', 'lib', 'tsc');
const res = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
