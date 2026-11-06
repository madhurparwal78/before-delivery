// Runs a copy with SERVER_CLOCK_START on its own empty schema and checks the
// cycle rollover, finished cycle records and digest timing on fixed dates.
import { spawn } from 'node:child_process';
import pg from 'pg';

const port = Number(process.env.CLOCK_PORT ?? '4197');
const base = `http://127.0.0.1:${port}`;
const clockStart = process.env.CLOCK_START ?? '2026-11-03T08:30:00+13:00';
const schema = 'clocktest';

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query(`drop schema if exists ${schema} cascade`);
await admin.query(`create schema ${schema}`);
await admin.end();

const databaseUrl = `${process.env.DATABASE_URL}?options=${encodeURIComponent(`-c search_path=${schema}`)}`;
const child = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, DATABASE_URL: databaseUrl, APP_PUBLIC_PORT: String(port), SERVER_CLOCK_START: clockStart },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => undefined);
child.stderr.on('data', (data) => process.stderr.write(`[copy] ${String(data)}`));

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return true;
    } catch {
      // not serving yet
    }
    await wait(500);
  }
  return false;
}

console.log('serving:', await ready());
await wait(4000);

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'tally-demo-1' }),
  });
  await response.json();
  return (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('tr_session='));
}

async function get(cookie, path) {
  const response = await fetch(base + path, { headers: { cookie } });
  return { status: response.status, json: await response.json() };
}

const ben = await signIn('ben@kereru.test');
const workspace = (await get(ben, '/api/workspace')).json;
console.log('today:', workspace.today, 'working day:', workspace.is_working_day);
console.log('next digest:', workspace.next_digest_at);

const current = (await get(ben, '/api/cycles/current')).json;
console.log('current cycle:', current.number, current.starts_at, current.ends_at, 'finished:', current.is_finished);
const finished = (await get(ben, '/api/cycles/1')).json;
console.log('cycle 1 finished:', finished.is_finished, 'keys:', finished.issue_keys);
console.log('cycle 1 burndown:', finished.burndown.map((entry) => `${entry.date}:${entry.open}`).join(' '));
const rolled = (await get(ben, '/api/issues?cycle=current')).json.issues.map((issue) => `${issue.key}:${issue.cycle_number}`);
console.log('issues reporting the current cycle:', rolled);
const closedInOne = (await get(ben, '/api/issues/KIL-3')).json;
console.log('closed issue keeps its cycle:', closedInOne.cycle_number, closedInOne.closed_at);
const cycleOneMembers = (await get(ben, '/api/issues?cycle=1')).json.issues.map((issue) => issue.key);
console.log('cycle 1 members:', cycleOneMembers);

// reopening an issue of a finished cycle leaves its record alone
await fetch(`${base}/api/issues/KIL-3/transition`, {
  method: 'POST',
  headers: { cookie: ben, 'content-type': 'application/json' },
  body: JSON.stringify({ to: 'in_progress' }),
});
const again = (await get(ben, '/api/cycles/1')).json;
console.log('record unchanged after reopening:', JSON.stringify(again.burndown) === JSON.stringify(finished.burndown));
console.log('members unchanged:', JSON.stringify(again.issue_keys) === JSON.stringify(finished.issue_keys));
const reopened = (await get(ben, '/api/issues/KIL-3')).json;
console.log('reopened issue reports the current cycle:', reopened.cycle_number);

const digests = await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent('subject:"digest for Tuesday 3 November"')).then((response) => response.json());
console.log('digests queued for the clock date:', digests.messages_count);

child.kill();
await wait(500);
