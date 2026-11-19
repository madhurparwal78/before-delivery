// Scratch check of the remaining published behaviours: body limits, mail
// recipients, realtime clock mode and the grading reset.
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

async function api(path, { method = 'GET', body, session, headers = {}, raw } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined && raw === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { cookie: `fs_session=${session}` } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

const seed = (await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } })).body;
const fernhill = seed.workspaces.fernhill.id;
const felix = seed.people.felix.session;
const w = (path) => `/api/w/${fernhill}${path}`;
const tick = (ms) => api('/api/grading/clock', { method: 'POST', headers: { 'X-Grading-Key': KEY }, body: { advanceMs: ms } });
await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

// Body size limits
const exact = JSON.stringify({ namespace: '00000000000000b200', fee: '1', dataBase64: 'A'.repeat(1048576 - 90) });
check('1 MiB body allowed', (await api(w('/blobs'), { method: 'POST', session: felix, raw: exact.slice(0, 1048576) })).status !== 413, true);
const tooBig = 'x'.repeat(1048577);
check('oversize body', await api(w('/blobs'), { method: 'POST', session: felix, raw: tooBig }), {
  status: 413,
  body: { error: 'Request body is too large.' },
});
const noType = await fetch(`${BASE}${w('/blobs')}`, { method: 'POST', headers: { cookie: `fs_session=${felix}` }, body: '{}' });
check('415 without JSON', [noType.status, await noType.json()], [415, { error: 'Send JSON.' }]);

// Unknown routes
check('unknown api route', (await api('/api/nope')).status, 404);
check('unknown workspace route', (await api(w('/nope'), { session: felix })).status, 404);

// Vote reminder mail: 120 s before proposal 3's voting end (10:06:15)
await tick(180000);
await new Promise((resolve) => setTimeout(resolve, 800));
const mail = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`)).json();
const reminders = mail.messages.filter((message) => message.Subject.startsWith('Reminder: proposal 3 closes at'));
check('vote reminder subject', reminders.map((message) => message.Subject), ['Reminder: proposal 3 closes at 10:06:15']);
check('vote reminder recipient', reminders[0]?.To.map((to) => to.Address), ['felix.navarro@fernhill.test']);

// Unbonding-complete mail
{
  const fresh = (await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } })).body;
  const path = (p) => `/api/w/${fresh.workspaces.fernhill.id}${p}`;
  await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  await api(path('/staking/undelegate'), {
    method: 'POST',
    session: fresh.people.felix.session,
    body: { validator: fresh.validators.fernhill.birch.id, amount: '300' },
  });
  await tick(15000);
  await tick(120000);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const box = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`)).json();
  check('unbonding mail', box.messages.filter((m) => m.Subject.startsWith('Unbonding complete')).map((m) => m.Subject), [
    'Unbonding complete: 300.000000 FERN from Birch',
  ]);
}

// Reset empties everything
const reset = await api('/api/grading/reset', { method: 'POST', headers: { 'X-Grading-Key': KEY } });
check('reset clock', reset.body, { clock: '2026-11-06T09:00:00.000Z' });
check('reset clears sessions', (await api('/api/me', { session: felix })).status, 401);
check('reset clears workspaces', (await api(w(''), { session: felix })).status, 401);

console.log(failures === 0 ? '\nEXTRA CHECKS PASSED' : `\n${failures} EXTRA CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
