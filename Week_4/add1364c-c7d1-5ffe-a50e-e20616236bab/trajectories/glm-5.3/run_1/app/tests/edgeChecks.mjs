/* API edge checks: body limits, content types, audit method guard, address fallbacks. */

const BASE = 'http://localhost:4173';
const checks = [];
function check(name, ok, detail) {
  checks.push([name, ok]);
  if (!ok) console.log(`FAIL  ${name} -> ${detail ?? ''}`);
}

const signIn = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
});
const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0];

async function j(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookie,
      ...(headers ?? {})
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

// DP-59: 413 for an oversized body; a body of exactly the limit is accepted.
const tooLarge = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x'.repeat(20000), password: 'y' })
});
check('DP-59 oversized body 413', tooLarge.status === 413, `status ${tooLarge.status}`);

const exact = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x'.repeat(16384 - 30), password: 'y' })
});
check('DP-59 exactly the limit accepted', exact.status !== 413, `status ${exact.status}`);

// DP-59: 415 for a non-JSON content type on a write.
const wrongType = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: 'username=marta'
});
check('DP-59 wrong content type 415', wrongType.status === 415, `status ${wrongType.status}`);

// DP-62: writes on the audit API answer 405 method_not_allowed.
const auditPost = await j('POST', '/api/audit', {});
check('DP-62 POST on audit 405', auditPost.status === 405, `status ${auditPost.status}`);
const auditPut = await j('PUT', '/api/audit', {});
check('DP-62 PUT on audit 405', auditPut.status === 405);

// DP-75: an invalid calendar month is replaced by the current office month.
const badMonth = await j('GET', '/api/rotations/calendar?month=2027-13');
check(
  'DP-75 invalid month replaced by office month',
  badMonth.status === 200 && /^\d{4}-\d{2}$/.test(badMonth.body.month),
  JSON.stringify(badMonth.body).slice(0, 80)
);

// DP-62: audit query validation.
const badLimit = await j('GET', '/api/audit?limit=101');
check('DP-62 limit over range 422', badLimit.status === 422, `status ${badLimit.status}`);
const zeroLimit = await j('GET', '/api/audit?limit=0');
check('DP-62 zero limit 422', zeroLimit.status === 422);
const badOrder = await j('GET', '/api/audit?order=sideways');
check('DP-62 bad order 422', badOrder.status === 422);

// DP-76/48: the health report answers past days and refuses future days.
const pastDay = await j('GET', '/api/health-report?day=2026-10-01');
check(
  'DP-76 past day with no check returns zeros',
  pastDay.status === 200 && pastDay.body.counts.exposed === 0 && pastDay.body.last_good_check_at === null,
  JSON.stringify(pastDay.body).slice(0, 100)
);
const futureDay = await j('GET', '/api/health-report?day=2027-01-01');
check('DP-48 future day refused 422', futureDay.status === 422);

// DP-41: the seeded review opened on the quarter's first office business day.
const reviews = await j('GET', '/api/reviews');
const q4 = reviews.body.reviews.find((r) => r.quarter === 'Q4 2026');
check('DP-41 seeded review opened on the first business day', Boolean(q4) && q4.opened_on === '2026-10-01', JSON.stringify(q4));

// DP-25: the office manager sets a travel window for a person.
const omSetsTravel = await j('POST', '/api/people/p-desmond/travel', { starts_at: '2026-12-01T09:00', ends_at: '2026-12-05T17:00' });
check('DP-25 office manager sets a travel window', omSetsTravel.status === 201, JSON.stringify(omSetsTravel.body).slice(0, 100));

let pass = 0;
for (const [name, ok] of checks) if (ok) pass += 1;
console.log(`edge checks: ${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
