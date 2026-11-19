// Verify the digest message subject and body for a cohort with a non-ASCII
// name, per DP-76/DP-77 and Services.
const BASE = 'http://127.0.0.1:4173';
const MAILPIT = 'http://mailpit:8025';

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return {}; } })(), headers: res.headers };
}

function cookieOf(setCookie) {
  return setCookie.split(';')[0];
}

// sign in as Wren
const signIn = await api('/api/session', { method: 'POST', body: JSON.stringify({ access_code: 'coach-wren-4417' }) });
const setCookie = signIn.headers.getSetCookie?.()[0] ?? signIn.headers.get('set-cookie') ?? '';
const wren = cookieOf(setCookie);
if (wren === '') {
  console.log('sign-in produced no cookie', signIn.status, signIn.body);
  process.exit(1);
}

// create a cohort with an accented name and an en dash, publish it, and let it run
const name = "Lune d'été – Équinoxe";
const create = await api('/api/coach/cohorts', {
  method: 'POST',
  headers: { Cookie: wren },
  body: JSON.stringify({ name, starts_on: '2026-11-10', price_cents: 12000, seats: 5 }),
});
if (create.status !== 201) {
  console.log('create failed', create.status, create.body);
  process.exit(1);
}
const cohortId = create.body.cohort.id;
await api(`/api/coach/cohorts/${cohortId}/publish`, { method: 'POST', headers: { Cookie: wren } });

// clear mailpit then send the digest
await fetch(MAILPIT + '/api/v1/messages', { method: 'DELETE' });
const digest = await api(`/api/coach/cohorts/${cohortId}/digest`, { method: 'POST', headers: { Cookie: wren } });
console.log('digest status:', digest.status, JSON.stringify(digest.body));

// fetch the message from mailpit
const list = await (await fetch(MAILPIT + '/api/v1/messages?limit=10')).json();
const msgs = list.messages ?? [];
console.log('message count:', msgs.length);
if (msgs.length > 0) {
  const m = msgs[0];
  console.log('subject:', JSON.stringify(m.Subject));
  const expected = `Lanternfish digest: ${name}, week ${digest.body.digest.week}`;
  console.log('subject matches exactly:', m.Subject === expected, '| expected:', JSON.stringify(expected));
  // fetch the body
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
  console.log('body:', JSON.stringify(full.Text));
}
