/** Walks the time-bounded rules: the undo window, sessions and erasure. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';
let cookie = '';
let failures = 0;

async function call(method, path, body) {
  const headers = {};
  if (cookie) headers['cookie'] = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : JSON.parse(text), headers: response.headers };
}

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

const signIn = await call('POST', '/api/sign-in', {
  email: 'noor@noorbakkerboards.example',
  password: 'desk-pass-2027',
});
const setCookie = signIn.headers.get('set-cookie') ?? '';
check('cookie is HttpOnly', setCookie.includes('HttpOnly'), true);
check('cookie is SameSite=Lax', setCookie.includes('SameSite=Lax'), true);
check('cookie is never Secure', setCookie.toLowerCase().includes('secure'), false);
check('cookie has no Max-Age', setCookie.toLowerCase().includes('max-age'), false);
check('cookie has no Expires', setCookie.toLowerCase().includes('expires'), false);

const clients = await call('GET', '/api/clients');
const client = clients.body.clients[0];
const jobs = await call('GET', `/api/jobs?clientId=${client.id}`);
const job = jobs.body.jobs[0];

// The undo window the server ends.
let board = (await call('GET', `/api/jobs/${job.id}/board`)).body;
const number = board.frames[1].number;
const removal = await call('POST', `/api/jobs/${job.id}/removals`, {
  frame: number,
  stamp: board.stamp,
});
check('removal opens a window', removal.status, 201);
const open = await call('GET', `/api/jobs/${job.id}/removals`);
check('the window is listed', open.body.removals.length >= 1, true);
const held = await call('POST', `/api/jobs/${job.id}/removals/${number}/hold`);
check('a hold renews it', held.status, 200);
check(
  'the hold moves the end on',
  new Date(held.body.endsAt).getTime() >= new Date(removal.body.endsAt).getTime(),
  true,
);
const undone = await call('POST', `/api/jobs/${job.id}/removals/${number}/undo`);
check('undo puts it back', undone.status, 200);
check(
  'in its exact place',
  undone.body.frames.find((frame) => frame.number === number)?.position,
  removal.body.position,
);

// Closing a client and bringing it back.
const made = await call('POST', '/api/clients', { name: 'Harbour Row Studio', place: 'dubai' });
const closing = await call('POST', `/api/clients/${made.body.id}/close`);
check('closing', closing.body.state, 'closing');
check('closesAt is set', typeof closing.body.closesAt, 'string');
check(
  'a write while closing',
  (await call('PATCH', `/api/clients/${made.body.id}`, { name: 'X' })).body.error.message,
  "This client is closing and can't change.",
);
const back = await call('POST', `/api/clients/${made.body.id}/bring-back`);
check('bring back', back.body.state, 'active');
check('closesAt is cleared', back.body.closesAt, null);
check(
  'bring back on an active client',
  (await call('POST', `/api/clients/${made.body.id}/bring-back`)).body.error.message,
  'This client is not closing.',
);
check('a client with no jobs is deleted', (await call('DELETE', `/api/clients/${made.body.id}`)).status, 204);
check('and then answers 404', (await call('GET', `/api/clients/${made.body.id}`)).status, 404);

// Changing the password ends the other sessions, and this one stays.
const otherSignIn = await fetch(`${base}/api/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'theo@noorbakkerboards.example', password: 'desk-pass-2027' }),
});
const otherCookie = (otherSignIn.headers.get('set-cookie') ?? '').split(';')[0];
const thirdSignIn = await fetch(`${base}/api/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'theo@noorbakkerboards.example', password: 'desk-pass-2027' }),
});
const thirdCookie = (thirdSignIn.headers.get('set-cookie') ?? '').split(';')[0];
const changed = await fetch(`${base}/api/password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: thirdCookie },
  body: JSON.stringify({ currentPassword: 'desk-pass-2027', newPassword: 'desk-pass-2028' }),
});
check('password changed', changed.status, 204);
const otherSession = await fetch(`${base}/api/session`, { headers: { cookie: otherCookie } });
check('the other session ended', otherSession.status, 401);
check('with the published code', (await otherSession.json()).error.code, 'session_ended');
check(
  'this one stays',
  (await fetch(`${base}/api/session`, { headers: { cookie: thirdCookie } })).status,
  200,
);
await fetch(`${base}/api/password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: thirdCookie },
  body: JSON.stringify({ currentPassword: 'desk-pass-2028', newPassword: 'desk-pass-2027' }),
});

// The ladder.
const ladder = await fetch(`${base}/api/clients`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.test' },
  body: JSON.stringify({ name: 'X', place: 'ontario' }),
});
check('a foreign origin beats authentication', ladder.status, 403);
const big = await fetch(`${base}/api/clients`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.test' },
  body: 'x'.repeat(1_000_001),
});
check('a body over its limit beats the origin', big.status, 413);
const unknown = await fetch(`${base}/api/nothing-here`, { method: 'POST' });
check('an unknown route beats everything', unknown.status, 404);
const wrongMethod = await fetch(`${base}/api/health`, { method: 'DELETE' });
check('a wrong method', wrongMethod.status, 405);
check('with Allow', wrongMethod.headers.get('allow'), 'GET, OPTIONS');
const noType = await fetch(`${base}/api/clients`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'text/plain' },
  body: '{}',
});
check('a wrong content type', noType.status, 415);
const badJson = await fetch(`${base}/api/clients`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: '{',
});
check('malformed JSON', badJson.status, 400);
check(
  'no cors echo',
  (await fetch(`${base}/api/health`, { headers: { origin: 'http://evil.test' } })).headers.get(
    'access-control-allow-origin',
  ),
  null,
);

console.log(failures === 0 ? '\nall ok' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
