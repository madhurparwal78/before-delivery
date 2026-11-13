// Starts or stops the built server by pidfile, for development runs.
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { openSync } from 'node:fs';

const root = dirname(import.meta.dirname);
const pidfile = join(root, '.tmp', 'server.pid');

/** Every pid whose /proc cmdline names the built server. */
async function serverPids() {
  const found = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8');
      if (cmdline.includes('dist/server.js')) found.push(Number(entry));
    } catch {
      // the process ended while we were reading it
    }
  }
  return found;
}

async function stop() {
  for (const pid of await serverPids()) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`stopped ${pid}`);
    } catch {
      // already gone
    }
  }
  await rm(pidfile, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const left = await serverPids();
  for (const pid of left) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function start(extraEnv = {}) {
  const log = openSync(join(root, '.tmp', 'server.log'), 'a');
  const child = spawn(process.execPath, [join(root, 'dist', 'server.js')], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', log, log],
    detached: true,
  });
  child.unref();
  await writeFile(pidfile, String(child.pid));
  console.log(`started ${child.pid}`);
}

const action = process.argv[2];
if (action === 'stop') {
  await stop();
} else if (action === 'start') {
  await stop();
  const extra = {};
  for (const pair of process.argv.slice(3)) {
    const index = pair.indexOf('=');
    extra[pair.slice(0, index)] = pair.slice(index + 1);
  }
  await start(extra);
} else {
  console.log('usage: node scripts/serverctl.mjs start|stop [KEY=value ...]');
  process.exit(2);
}
