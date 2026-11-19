/* Midnight push test: boots a server whose clock starts at 2026-12-31 23:59:30 office time,
 * opens the event stream, and checks the rule-in-force push arrives within five seconds of
 * the office midnight at which the seeded Banking rule takes force (2027-01-01). */

import { spawn } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function resetDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const table of tables.rows) {
    await pool.query(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE`);
  }
  await pool.query('DROP SEQUENCE IF EXISTS row_seq_seq CASCADE');
  await pool.end();
}

await resetDatabase();
console.log('database cleared');

// Seed with a clock starting late on 2026-12-31, so the Banking rule (2027-01-01) takes force in ~30s.
const server = spawn('node', ['dist/server.js'], {
  env: {
    ...process.env,
    OFFICE_KEY: process.env.OFFICE_KEY ?? 'bl',
    APP_PUBLIC_PORT: '4175',
    LOCKSET_CLOCK_START: '2026-12-31T23:58:30-06:00'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

const BASE = 'http://localhost:4175';
let healthy = false;
for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) healthy = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!healthy) {
  console.error('server not healthy');
  server.kill('SIGKILL');
  process.exit(1);
}
console.log('server healthy');

// sign in and open the event stream
const signIn = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
});
const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0];

const events = [];
const controller = new AbortController();
const stream = await fetch(`${BASE}/api/events`, {
  headers: { Cookie: cookie },
  signal: controller.signal
});
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
const reading = (async () => {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const nameMatch = /^event: (.+)$/m.exec(chunk);
        const dataMatch = /^data: (.+)$/m.exec(chunk);
        if (nameMatch) {
          events.push({ name: nameMatch[1], data: dataMatch ? dataMatch[1] : '', at: Date.now() });
        }
        index = buffer.indexOf('\n\n');
      }
    }
  } catch {
    // stream closed
  }
})();

// wait for the midnight to pass: clock started 23:58:30, midnight at 24:00 = 90 seconds after start
console.log('waiting for the office midnight…');
await new Promise((resolve) => setTimeout(resolve, 100_000));
controller.abort();
server.kill('SIGKILL');

const ruleEvents = events.filter((event) => event.name === 'rule-in-force');
console.log('rule-in-force events:', JSON.stringify(ruleEvents));
const bankingPush = ruleEvents.find((event) => {
  try {
    const data = JSON.parse(event.data);
    return data.name === 'Banking';
  } catch {
    return false;
  }
});

let pass = 0;
const checks = [
  ['DP-36 rule-in-force push arrived', Boolean(bankingPush)],
  ['DP-36 push names the Banking vault', bankingPush ? JSON.parse(bankingPush.data).name === 'Banking' : false]
];
for (const [name, ok] of checks) {
  if (ok) pass += 1;
  else console.log(`FAIL  ${name}`);
}
console.log(`midnight push checks: ${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
