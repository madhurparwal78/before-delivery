/** Development helper: stop any running copy, then start a fresh one. */
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const target = process.argv[2] ?? 'restart';
const logPath = process.env.LOG ?? '/tmp/server.log';
const port = process.env.APP_PUBLIC_PORT ?? '4173';

async function running() {
  const pids = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = await readFile(`/proc/${entry}/cmdline`, 'utf8');
      if (commandLine.includes('dist/server/main.js')) pids.push(Number(entry));
    } catch {
      /* the process exited while we looked */
    }
  }
  return pids;
}

for (const pid of await running()) {
  if (pid === process.pid) continue;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

if (target === 'stop') process.exit(0);

await new Promise((resolve) => setTimeout(resolve, 400));
const log = openSync(logPath, 'a');
const child = spawn(process.execPath, ['dist/server/main.js'], {
  detached: true,
  stdio: ['ignore', log, log],
  env: { ...process.env, APP_PUBLIC_PORT: port },
});
child.unref();

for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (response.ok) {
      console.log(`server ready on ${port}`);
      process.exit(0);
    }
  } catch {
    /* not up yet */
  }
}
console.error('server did not become ready');
process.exit(1);
