/** Restarts the built server for local checks: stops any running instance, then starts one. */
import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

for (const entry of readdirSync('/proc')) {
  if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
  try {
    const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
    if (cmdline.includes('dist/server/index.js')) process.kill(Number(entry), 'SIGTERM');
  } catch {
    // The process is gone already.
  }
}

if (process.argv[2] !== 'stop') {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GRADING: process.env.GRADING ?? '1' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (chunk) => log.push(chunk));
  child.stderr.on('data', (chunk) => log.push(chunk));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  process.stdout.write(Buffer.concat(log).toString());
  child.unref();
  process.exit(0);
}
