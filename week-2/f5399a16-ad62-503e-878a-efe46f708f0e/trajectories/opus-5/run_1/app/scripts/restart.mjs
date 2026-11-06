/** Restarts the local copy while building, since this box has no ps or pkill. */
import { readdir, readFile } from 'node:fs/promises';

for (const entry of await readdir('/proc')) {
  if (!/^\d+$/.test(entry) || entry === String(process.pid)) continue;
  try {
    const line = await readFile(`/proc/${entry}/cmdline`, 'utf8');
    if (line.includes('dist/server.js')) {
      process.kill(Number(entry), 'SIGKILL');
      console.log(`stopped ${entry}`);
    }
  } catch {
    // The process is already gone.
  }
}
