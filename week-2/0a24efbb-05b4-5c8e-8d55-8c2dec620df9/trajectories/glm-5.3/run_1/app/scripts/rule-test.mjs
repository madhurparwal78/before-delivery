// Deeper rule tests: lockout, session expiry, live reporting lines, policy races.
const BASE = 'http://127.0.0.1:4173';
const PASSWORD = 'deku-demo-pw-2026';
let passes = 0, failures = 0;
const check = (label, cond, extra) => {
  if (cond) passes++;
  else { failures++; console.log('FAIL:', label, extra ?? ''); }
};
const api = async (token, path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { res, body };
};
const signIn = async (address, password = PASSWORD) => {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ work_address: address, password }),
  });
  return { res, body: await res.json().catch(() => ({})) };
};

const run = async () => {
  // --- lockout: five refusals lock the address; the refusal that brings the
  // count to five is itself a refusal, and every attempt after it is locked
  const lockAddr = `employee2@example.com`;
  for (let i = 0; i < 5; i++) {
    await signIn(lockAddr, 'wrong');
  }
  let r = await signIn(lockAddr, 'wrong');
  check('sixth attempt 429 after five refusals', r.res.status === 429 && r.body.error === 'Too many attempts for this address. Try again later.', JSON.stringify([r.res.status, r.body]));
  check('Retry-After set', /^\d+$/.test(r.res.headers.get('retry-after') || ''), r.res.headers.get('retry-after'));
  // the right password is refused during the lock
  r = await signIn(lockAddr, PASSWORD);
  check('locked right password 429', r.res.status === 429, r.res.status);
  // a different address is unaffected
  r = await signIn('employee3@example.com', PASSWORD);
  check('other address signs in', r.res.status === 200);

  // --- 400 is not counted as an attempt
  r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ work_address: 'employee7@example.com' }),
  });
  check('missing password 400', r.status === 400);
  r = await signIn('employee7@example.com', PASSWORD);
  check('not locked after 400', r.res.status === 200);

  // --- live reporting lines: move Nadia (7) to Omar (3) and back
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const seeded = await client.query('SELECT seeded_on FROM employer WHERE id = 1');
  const seededOn = seeded.rows[0].seeded_on.toISOString().slice(0, 10);
  const [sy, sm, sd] = seededOn.split('-').map(Number);
  const atOffset = (n) => new Date(Date.UTC(sy, sm - 1, sd) - n * 86400000).toISOString().slice(0, 10);

  const dara = await signIn('manager@example.com');
  const omar = await signIn('manager2@example.com');
  const nadia = await signIn('employee3@example.com');

  let q = await api(dara.body.token, '/api/requests?person=employee3@example.com');
  check('Dara sees Nadia by filter', q.body.matched > 0, JSON.stringify(q.body.matched));

  await client.query('UPDATE person SET manager_id = 3 WHERE id = 7');

  q = await api(dara.body.token, '/api/requests?person=employee3@example.com');
  check('old manager loses Nadia on next read', q.body.matched === 0, JSON.stringify(q.body.matched));
  q = await api(omar.body.token, '/api/requests?person=employee3@example.com');
  check('new manager gains Nadia on next read', q.body.matched > 0);
  // calendar people follow
  const cal = await api(dara.body.token, '/api/calendar');
  check('calendar people follow the move', (cal.body.people || []).every((p) => p.name !== 'Nadia Kerr'), JSON.stringify((cal.body.people || []).map((p) => p.name)));
  // her requests answer the old manager 404
  const nadiaRows = await api(omar.body.token, '/api/requests?person=employee3@example.com');
  const nid = nadiaRows.body.rows[0]?.id;
  if (nid) {
    const outOfScope = await api(dara.body.token, `/api/requests/${nid}`);
    check('moved report answers old manager 404', outOfScope.res.status === 404);
  }

  await client.query('UPDATE person SET manager_id = 2 WHERE id = 7');
  q = await api(dara.body.token, '/api/requests?person=employee3@example.com');
  check('moved back', q.body.matched > 0);

  // --- live deactivation: an inactive person's open session ends
  await client.query("UPDATE person SET active = false WHERE id = 7");
  r = await api(nadia.body.token, '/api/requests');
  check('deactivated session 401 ended', r.res.status === 401 && r.body.error === 'Your session has ended. Sign in again.', JSON.stringify(r.body));
  r = await signIn('employee3@example.com');
  check('deactivated sign-in refused', r.res.status === 401);
  await client.query("UPDATE person SET active = true WHERE id = 7");

  // --- simultaneous decisions on one request: exactly one wins
  // request 3 (Suri, pending, outside window for approval — use a fresh one instead)
  // raise one fresh pending request on a free day
  const suri = await signIn('employee5@example.com');
  const fresh = await api(suri.body.token, '/api/requests', {
    method: 'POST',
    body: JSON.stringify({ day: atOffset(11), correction_type: 'missed_in', claimed_in: '09:00', reason: 'Simultaneous decision test reason here.' }),
  });
  check('fresh raise 201', fresh.res.status === 201, JSON.stringify(fresh.body).slice(0, 120));
  const id = fresh.body.id;
  const [a, b] = await Promise.all([
    api(omar.body.token, `/api/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) }),
    api(omar.body.token, `/api/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) }),
  ]);
  const statuses = [a.res.status, b.res.status].sort();
  check('one 200 one 409', statuses[0] === 200 && statuses[1] === 409, JSON.stringify(statuses));
  check('409 names the decider', (a.res.status === 409 ? a.body : b.body).decided_by === 'Omar Vance', JSON.stringify(a.res.status === 409 ? a.body : b.body));
  // attendance now reads the claimed time
  const detail = await api(omar.body.token, `/api/requests/${id}`);
  check('attendance written once', detail.body.evidence.source === 'regularisation' && detail.body.evidence.recorded_in && detail.body.evidence.recorded_in.slice(0, 10) === atOffset(11), JSON.stringify(detail.body.evidence));

  // --- simultaneous raises for one day create exactly one
  const [r1, r2] = await Promise.all([
    api(suri.body.token, '/api/requests', { method: 'POST', body: JSON.stringify({ day: atOffset(10), correction_type: 'missed_out', claimed_out: '18:00', reason: 'Simultaneous raise test reason here.' }) }),
    api(suri.body.token, '/api/requests', { method: 'POST', body: JSON.stringify({ day: atOffset(10), correction_type: 'missed_out', claimed_out: '18:00', reason: 'Simultaneous raise test reason here.' }) }),
  ]);
  const raiseStatuses = [r1.res.status, r2.res.status].sort();
  check('raises: one 201 one 409', raiseStatuses[0] === 201 && raiseStatuses[1] === 409, JSON.stringify(raiseStatuses));

  // --- simultaneous policy saves: one 201, one 412, contiguous versions
  const admin = await signIn('admin@example.com');
  const pol = await api(admin.body.token, '/api/policy');
  const etag = pol.res.headers.get('etag');
  const body = JSON.stringify({
    monthly_cap: 3, lookback_days: 30,
    enabled_types: ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'],
    require_note_on_approve: false,
  });
  const [s1, s2] = await Promise.all([
    api(admin.body.token, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body }),
    api(admin.body.token, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body }),
  ]);
  const saveStatuses = [s1.res.status, s2.res.status].sort();
  check('policy saves: one 201 one 412', saveStatuses[0] === 201 && saveStatuses[1] === 412, JSON.stringify(saveStatuses));
  const hist = await api(admin.body.token, '/api/policy/history');
  const versions = hist.body.versions.map((v) => v.version);
  check('versions contiguous', versions.every((v, i) => i === 0 || v === versions[i - 1] - 1), JSON.stringify(versions));
  const maxv = Math.max(...versions);
  check('highest equals count', versions.length === maxv, `${versions.length} vs ${maxv}`);

  // --- trail verify after all that
  const verify = await api(admin.body.token, '/api/trail/verify');
  check('trail intact after races', verify.body.intact === true, JSON.stringify(verify.body));

  // --- cap at approval and at raise: Clara is at the seeded cap (3 approved
  // in the cap month, the month containing offset 29)
  const clara = await signIn('employee9@example.com');
  const lena = await signIn('manager3@example.com');
  const capMonthDay = atOffset(29); // the cap month's last day, inside the window
  const capMonth = capMonthDay.slice(0, 7);
  r = await api(clara.body.token, '/api/requests', {
    method: 'POST',
    body: JSON.stringify({ day: capMonthDay, correction_type: 'missed_in', claimed_in: '09:00', reason: 'A fourth correction over the seeded cap is refused.' }),
  });
  check('cap raise refused 422', r.res.status === 422 && r.body.error === `You have 3 of 3 corrections approved or waiting in ${capMonth}.`, JSON.stringify(r.body));

  // a raise in a month under the cap succeeds, then approvals are weighed
  // against the policy in force at the moment of approval
  const dayA = atOffset(6);
  const dayB = atOffset(7);
  const raiseA = await api(clara.body.token, '/api/requests', {
    method: 'POST',
    body: JSON.stringify({ day: dayA, correction_type: 'missed_in', claimed_in: '09:00', reason: 'A first correction for approval weighing.' }),
  });
  check('raise A 201', raiseA.res.status === 201, JSON.stringify(raiseA.body).slice(0, 100));
  const raiseB = await api(clara.body.token, '/api/requests', {
    method: 'POST',
    body: JSON.stringify({ day: dayB, correction_type: 'missed_in', claimed_in: '09:00', reason: 'A second correction for approval weighing.' }),
  });
  check('raise B 201', raiseB.res.status === 201, JSON.stringify(raiseB.body).slice(0, 100));
  // approve both: the cap in their month is 3 and only 0-1 are approved
  r = await api(lena.body.token, `/api/requests/${raiseA.body.id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('approve A 200', r.res.status === 200, JSON.stringify(r.body).slice(0, 100));
  // tighten the cap to 1, then approve B: refused at the cap then in force
  const pol2 = await api(admin.body.token, '/api/policy');
  const etag2 = pol2.res.headers.get('etag');
  r = await api(admin.body.token, '/api/policy', {
    method: 'PUT',
    headers: { 'if-match': etag2 },
    body: JSON.stringify({ monthly_cap: 1, lookback_days: 30, enabled_types: ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'], require_note_on_approve: false }),
  });
  check('tighten cap to 1', r.res.status === 201, JSON.stringify(r.body).slice(0, 100));
  r = await api(lena.body.token, `/api/requests/${raiseB.body.id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('approval over tightened cap 422', r.res.status === 422 && r.body.error === `Clara Mendt has used 1 of 1 corrections in ${dayB.slice(0, 7)}.`, JSON.stringify(r.body));
  check('request stays pending after cap refusal', (await api(lena.body.token, `/api/requests/${raiseB.body.id}`)).body.request.state === 'pending');
  // put the cap back to 3 so the rest of the seed stays at its defaults
  const pol3 = await api(admin.body.token, '/api/policy');
  r = await api(admin.body.token, '/api/policy', {
    method: 'PUT',
    headers: { 'if-match': pol3.res.headers.get('etag') },
    body: JSON.stringify({ monthly_cap: 3, lookback_days: 30, enabled_types: ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'], require_note_on_approve: false }),
  });
  check('restore cap 3', r.res.status === 201);

  // --- approved leave blocks a raise: Suri has approved annual leave at offset 5
  const leaveDay = atOffset(5);
  // Clara used offset 5 above; use Suri for the leave check
  r = await api(suri.body.token, '/api/requests', { method: 'POST', body: JSON.stringify({ day: leaveDay, correction_type: 'missed_in', claimed_in: '09:00', reason: 'A raise on an approved leave day.' }) });
  check('leave day raise 422', r.res.status === 422 && r.body.error === `You were on approved leave on ${leaveDay}.`, JSON.stringify(r.body));

  // --- night shift rules: claimed_out earlier than claimed_in
  r = await api(suri.body.token, '/api/requests', { method: 'POST', body: JSON.stringify({ day: atOffset(9), correction_type: 'night_shift', claimed_in: '22:00', claimed_out: '06:00', reason: 'A night shift that ends the next morning.' }) });
  check('night shift 201', r.res.status === 201, JSON.stringify(r.body).slice(0, 100));
  // approving it writes the sign-out on the following business day
  r = await api(omar.body.token, `/api/requests/${r.body.id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('night shift approve 200', r.res.status === 200, JSON.stringify(r.body).slice(0, 100));
  const row = await client.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, recorded_out FROM attendance_day WHERE person_id = 9 AND to_char(day, 'YYYY-MM-DD') = $1", [atOffset(8)]);
  check('night sign-out on following day', row.rows.length > 0, 'no row');

  await client.end();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
