// Checks the short-timers copy behaviour: build duration divisor, job completion on read,
// raid abandonment after the finalize deadline, cooldown and shield windows.
const BASE = process.argv[2] ?? 'http://127.0.0.1:4191';
const suffix = Date.now();

let cookies = '';
let csrf = '';
async function call(method, path, body, extra = {}) {
  const headers = { ...(cookies ? { Cookie: cookies } : {}), ...extra };
  if (method !== 'GET' || body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['X-CSRF-Token'] = csrf;
  }
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookies = sc.map((c) => c.split(';')[0]).join('; ');
  let data = null;
  try { data = await res.json(); } catch {}
  if (data?.csrfToken) csrf = data.csrfToken;
  return { status: res.status, data };
}
const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await call('GET', '/api/session');
// fresh islander on the short-timers copy
const email = `short-${suffix}@lowtide.test`;
const signup = await call('POST', '/api/auth/signup', { email, password: 'Saltflat-Test-10', displayName: 'Short Timer', timeZone: 'UTC' });
check('signup ok', signup.status === 202, signup);
// verify token lifetime is 20s: verifying after 24s fails with invalid_token
await sleep(24000);
const tokens = [];
for (;;) {
  const list = await (await fetch('http://mailpit:8025/api/v1/messages?limit=50')).json();
  const mine = list.messages.filter((m) => m.To[0].Address === email && m.Subject === 'Confirm your Saltreach email');
  if (mine.length > 0) {
    const body = await (await fetch(`http://mailpit:8025/api/v1/message/${mine[0].ID}`)).json();
    tokens.push((body.Text.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1]);
    break;
  }
  await sleep(2000);
}
const expired = await call('POST', '/api/auth/verify', { token: tokens[0] });
check('verify token expires after 20s', expired.status === 400 && expired.data.error === 'invalid_token', expired);
// resend, then verify quickly (wait for the new mail to arrive, not the superseded one)
const resend = await call('POST', '/api/auth/resend-verification', { email });
check('resend accepted', resend.status === 202, resend);
const firstId = tokens.length > 0 ? Number(await mailIdFor(email)) : -1;
async function mailIdFor(addr) {
  const list = await (await fetch('http://mailpit:8025/api/v1/messages?limit=50')).json();
  const mine = list.messages.filter((m) => m.To[0].Address === addr && m.Subject === 'Confirm your Saltreach email').sort((a, b) => b.ID - a.ID);
  return mine.length > 0 ? mine[0].ID : null;
}
let freshToken = null;
let newestId = null;
for (let i = 0; i < 12 && freshToken === null; i++) {
  const list = await (await fetch('http://mailpit:8025/api/v1/messages?limit=50')).json();
  const mine = list.messages.filter((m) => m.To[0].Address === email && m.Subject === 'Confirm your Saltreach email').sort((a, b) => b.ID - a.ID);
  if (mine.length >= 2) {
    newestId = mine[0].ID;
    const body = await (await fetch(`http://mailpit:8025/api/v1/message/${newestId}`)).json();
    freshToken = (body.Text.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1];
  } else {
    await sleep(2000);
  }
}
void firstId;
const verified = await call('POST', '/api/auth/verify', { token: freshToken });
check('resend then verify works', verified.status === 200, verified);

const signin = await call('POST', '/api/auth/signin', { email, password: 'Saltflat-Test-10' });
check('signin works', signin.status === 200, signin);
// build duration divisor 10: brine pan level 1 takes 1s
const place = await call('POST', '/api/village/buildings', { type: 'brine_pan', x: 5, y: 5, rotation: 0 });
check('placed with 1s build', place.status === 201, place);
await sleep(2500);
const village = await call('GET', '/api/village');
const placed = village.data.buildings.find((b) => b.type === 'brine_pan' && b.x === 5);
check('job finished by server time', placed.level === 1 && placed.upgrade === null, placed);
check('saltmark rose to 6', village.data.saltmark === 6, village.data.saltmark);

// raid abandonment: lock, do nothing, wait past the 20s finalize deadline
const next = await call('GET', '/api/scout/next');
check('scout found target', next.status === 200 && next.data.match !== null, next.data);
const target = next.data.match.villageId;
const raid = await call('POST', '/api/raids', { villageId: target }, { 'Idempotency-Key': `short-raid-${suffix}` });
check('raid locked', raid.status === 201, raid.data?.state);
await sleep(22000);
const after = await call('GET', `/api/raids/${raid.data.id}`);
check('raid abandoned after deadline', after.data.state === 'abandoned' && after.data.endReason === 'deadline_passed', { state: after.data.state, reason: after.data.endReason });
const again = await call('POST', `/api/raids/${raid.data.id}/finalize`, {}, { 'Idempotency-Key': `short-fin-${suffix}` });
check('finalize after deadline answers raid_abandoned', again.status === 409 && again.data.error === 'raid_abandoned', again.data);
const relock = await call('POST', '/api/raids', { villageId: target }, { 'Idempotency-Key': `short-raid2-${suffix}` });
check('target can be locked again', relock.status === 201, relock.data?.state);
const deploy = await call('POST', `/api/raids/${relock.data.id}/deploys`, { deploys: [{ tick: 0, unit: 'saltjack', x: 0, y: 20 }] }, { 'Idempotency-Key': `short-dep-${suffix}` });
check('deploy accepted', deploy.status === 200, deploy.data?.state);
const fin = await call('POST', `/api/raids/${relock.data.id}/finalize`, {}, { 'Idempotency-Key': `short-fin2-${suffix}` });
check('finalize resolves', fin.status === 200 && fin.data.state === 'resolved' && fin.data.result !== null, fin.data?.state);
const cooldown = await call('POST', '/api/raids', { villageId: target }, { 'Idempotency-Key': `short-raid3-${suffix}` });
check('same-target cooldown answers target_cooldown', cooldown.status === 409 && cooldown.data.error === 'target_cooldown', cooldown.data);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} short-timer checks passed`);
if (failed > 0) process.exitCode = 1;
