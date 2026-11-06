// Checks the clock copies: each boots with SALTREACH_CLOCK_START five minutes before a named
// local boundary, then the local-day and local-week rules are verified as the clock crosses it.
import { spawn } from 'node:child_process';

const COPIES = [
  { port: 4192, zone: 'America/Havana', clockStart: '2027-03-14T04:55:00.000Z', boundary: '2027-03-14T05:00:00.000Z', dayEnd: '2027-03-15T04:00:00.000Z' },
  { port: 4193, zone: 'America/Santiago', clockStart: '2027-09-05T03:55:00.000Z', boundary: '2027-09-05T04:00:00.000Z', dayEnd: '2027-09-06T03:00:00.000Z' },
  { port: 4194, zone: 'Asia/Kathmandu', clockStart: '2027-09-05T18:10:00.000Z', boundary: '2027-09-05T18:15:00.000Z', dayEnd: '2027-09-06T18:15:00.000Z' },
  { port: 4195, zone: 'Europe/Lisbon', clockStart: '2027-10-31T23:55:00.000Z', boundary: '2027-11-01T00:00:00.000Z', dayEnd: '2027-11-02T00:00:00.000Z', weekStart: '2027-11-01T00:00:00.000Z' },
  { port: 4196, zone: 'Pacific/Kiritimati', clockStart: '2028-12-31T09:55:00.000Z', boundary: '2028-12-31T10:00:00.000Z', dayEnd: '2029-01-01T10:00:00.000Z', weekStart: '2028-12-31T10:00:00.000Z' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`);
}

const children = [];
process.on('exit', () => {
  for (const child of children) child.kill('SIGKILL');
});

for (const copy of COPIES) {
  const child = spawn('node', ['dist/server.js'], {
    env: {
      ...process.env,
      APP_PUBLIC_PORT: String(copy.port),
      APP_PUBLIC_URL: `http://127.0.0.1:${copy.port}`,
      SALTREACH_CLOCK_START: copy.clockStart,
    },
    stdio: 'ignore',
  });
  children.push(child);
}
await sleep(4000);

async function runCopy(copy) {
  const base = `http://127.0.0.1:${copy.port}`;
  let cookies = '';
  let csrf = '';
  const call = async (method, path, body) => {
    const headers = { ...(cookies ? { Cookie: cookies } : {}) };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie?.() ?? [];
    if (sc.length) cookies = sc.map((c) => c.split(';')[0]).join('; ');
    let data = null;
    try { data = await res.json(); } catch {}
    if (data?.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data };
  };

  const email = `clock-${copy.port}-${Date.now()}@lowtide.test`;
  await call('GET', '/api/session');
  await call('POST', '/api/auth/signup', { email, password: 'Saltflat-Test-10', displayName: `Clock ${copy.port}`, timeZone: copy.zone });
  const signin = await call('POST', '/api/auth/signin', { email, password: 'Saltflat-Test-10' });
  check(`copy ${copy.zone} signin`, signin.status === 200, signin);

  const first = await call('POST', '/api/me/rewards/daily', {});
  check(`copy ${copy.zone} first daily claim (streak 1)`, first.status === 200 && first.data.streak === 1, first.data);

  // wait for the boundary to pass, watching the period start move
  let crossed = false;
  for (let i = 0; i < 100 && !crossed; i++) {
    const rewards = await call('GET', '/api/me/rewards');
    if (rewards.data.daily.periodStart === copy.boundary) {
      crossed = true;
      break;
    }
    await sleep(5000);
  }
  check(`copy ${copy.zone} daily period starts at the boundary ${copy.boundary}`, crossed, 'period never matched');

  const second = await call('POST', '/api/me/rewards/daily', {});
  check(
    `copy ${copy.zone} second daily claim right after the boundary (streak 2)`,
    second.status === 200 && second.data.streak === 2 && second.data.nextClaimAt === copy.dayEnd,
    second.data
  );

  if (copy.weekStart) {
    const rewards = await call('GET', '/api/me/rewards');
    check(`copy ${copy.zone} weekly period starts at ${copy.weekStart}`, rewards.data.weekly.periodStart === copy.weekStart, rewards.data.weekly);
  }
}

await Promise.all(COPIES.map((copy) => runCopy(copy)));
for (const child of children) child.kill('SIGKILL');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} clock-copy checks passed`);
if (failed.length > 0) process.exitCode = 1;
