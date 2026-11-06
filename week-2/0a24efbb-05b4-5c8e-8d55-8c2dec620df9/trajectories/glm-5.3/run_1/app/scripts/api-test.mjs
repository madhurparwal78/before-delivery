// Comprehensive API smoke test against the running desk.
const BASE = 'http://127.0.0.1:4173';
const PASSWORD = 'deku-demo-pw-2026';

let failures = 0;
let passes = 0;
function check(label, cond, extra) {
  if (cond) { passes++; }
  else { failures++; console.log('FAIL:', label, extra ?? ''); }
}

async function signIn(address, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ work_address: address, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { res, body };
}

const run = async () => {
  // --- health
  let r = await api(null, '/api/health');
  check('health 200', r.res.status === 200, r.res.status);

  // --- sign in: unknown address, wrong password, deactivated
  r = await signIn('nobody@example.com');
  check('unknown address 401', r.res.status === 401 && r.body.error === 'Those details do not match an account', JSON.stringify(r.body));
  r = await signIn('employee@example.com', 'wrong');
  check('wrong password 401', r.res.status === 401 && r.body.error === 'Those details do not match an account');
  r = await signIn('employee12@example.com');
  check('deactivated 401', r.res.status === 401 && r.body.error === 'Those details do not match an account');

  // --- folded addresses
  r = await signIn('EMPLOYEE@EXAMPLE.COM');
  check('uppercase signs in', r.res.status === 200, JSON.stringify(r.body).slice(0, 80));
  r = await signIn('ＥＭＰＬＯＹＥＥ@example.com');
  check('fullwidth signs in', r.res.status === 200, JSON.stringify(r.body).slice(0, 80));
  const cyrillic = 'іris.calder@example.com';
  r = await signIn(cyrillic);
  check('look-alike refused', r.res.status === 401 && r.body.error === 'Those details do not match an account');

  // --- sessions
  const emp = await signIn('employee@example.com');
  const empTok = emp.body.token;
  const mgr = await signIn('manager@example.com');
  const mgrTok = mgr.body.token;
  const mgr2 = await signIn('manager2@example.com');
  const mgr2Tok = mgr2.body.token;
  const admin = await signIn('admin@example.com');
  const adminTok = admin.body.token;

  // --- unauthenticated calls refused
  r = await api(null, '/api/requests');
  check('no session 401', r.res.status === 401 && r.body.error === 'Sign in to continue.', JSON.stringify(r.body));
  r = await api('forged-token-abc', '/api/requests');
  check('forged token 401', r.res.status === 401 && r.body.error === 'Sign in to continue.');

  // --- signed out token refused
  const tmp = await signIn('employee3@example.com');
  r = await api(tmp.body.token, '/api/session', { method: 'DELETE' });
  check('sign out 204', r.res.status === 204);
  r = await api(tmp.body.token, '/api/requests');
  check('signed-out token 401', r.res.status === 401 && r.body.error === 'Sign in to continue.', JSON.stringify(r.body));

  // --- employee scope: only own requests
  r = await api(empTok, '/api/requests');
  check('employee queue 200', r.res.status === 200);
  check('employee sees only own', r.body.rows.every((row) => row.work_address === 'employee@example.com'), JSON.stringify(r.body.rows.map((x) => x.work_address)));
  check('employee sees request 1', r.body.rows.some((row) => row.id === 1));
  check('queue fields', ['rows', 'matched', 'total', 'page', 'pages'].every((k) => k in r.body));

  // --- employee cannot read another person's request
  r = await api(empTok, '/api/requests/4');
  check('employee out-of-scope 404', r.res.status === 404 && r.body.error === 'No such request.', JSON.stringify(r.body));

  // --- employee cannot change policy
  r = await api(empTok, '/api/policy', { method: 'PUT', headers: { 'if-match': '"1"' }, body: JSON.stringify({ monthly_cap: 2, lookback_days: 20, enabled_types: ['missed_in'], require_note_on_approve: false }) });
  check('employee policy 403', r.res.status === 403 && r.body.error === 'Only people operations changes the policy.');

  // --- manager scope
  r = await api(mgrTok, '/api/requests');
  check('manager sees reports', r.body.rows.some((row) => row.id === 2), 'should see request 2 (Nadia)');
  r = await api(mgrTok, '/api/requests/4');
  check('manager other-team 404', r.res.status === 404, JSON.stringify(r.body));
  r = await api(mgr2Tok, '/api/requests/4');
  check('manager2 sees request 4', r.res.status === 200);

  // --- admin scope
  r = await api(adminTok, '/api/requests');
  check('admin sees all', r.body.total >= 9, 'total ' + r.body.total);
  r = await api(adminTok, '/api/requests/4');
  check('admin detail has contact', r.body.contact && r.body.contact.phone === '07700 900111', JSON.stringify(r.body.contact));
  r = await api(mgr2Tok, '/api/requests/4');
  check('manager detail has no contact key', !('contact' in r.body), Object.keys(r.body));

  // --- admin cannot decide
  r = await api(adminTok, '/api/requests/1/decision', { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('admin decide 403', r.res.status === 403 && r.body.error === 'People operations does not decide requests.');

  // --- self decision refused
  const raiseRes = await api(mgr2Tok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-01', correction_type: 'missed_in', claimed_in: '09:00', reason: 'Testing my own request for the self decision rule.' }) });
  check('manager raise 201', raiseRes.res.status === 201, JSON.stringify(raiseRes.body));
  if (raiseRes.res.status === 201) {
    r = await api(mgr2Tok, `/api/requests/${raiseRes.body.id}/decision`, { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
    check('self decision 403', r.res.status === 403 && r.body.error === 'You cannot decide a request you raised.');
    r = await api(mgr2Tok, `/api/requests/${raiseRes.body.id}/cancel`, { method: 'POST' });
    check('withdraw own 200', r.res.status === 200 && r.body.state === 'cancelled', JSON.stringify(r.body).slice(0, 120));
    r = await api(mgr2Tok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-01', correction_type: 'missed_in', claimed_in: '09:00', reason: 'Raising again after the withdrawal freed the day.' }) });
    check('freed day raise 201', r.res.status === 201, JSON.stringify(r.body).slice(0, 120));
    if (r.res.status === 201) {
      await api(mgr2Tok, `/api/requests/${r.body.id}/cancel`, { method: 'POST' });
    }
  }

  // --- decision by the right manager: request 1 (Iris, Dara's report)
  r = await api(mgrTok, '/api/requests/1/decision', { method: 'POST', body: JSON.stringify({ outcome: 'reject', note: 'The reader log shows the sign-out after all.' }) });
  check('manager reject 200', r.res.status === 200 && r.body.state === 'rejected' && r.body.decided_by === 'Dara Finch', JSON.stringify(r.body).slice(0, 150));
  r = await api(mgrTok, '/api/requests/1/decision', { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('already decided 409', r.res.status === 409 && r.body.decided_by === 'Dara Finch', JSON.stringify(r.body));

  // --- rejection note rules
  r = await api(mgrTok, '/api/requests/2/decision', { method: 'POST', body: JSON.stringify({ outcome: 'reject', note: 'short' }) });
  check('short note 400', r.res.status === 400 && r.body.error === 'A rejection needs a note of at least ten characters.', JSON.stringify(r.body));

  // --- approval writes attendance: request 2 (Nadia, Dara's report)
  r = await api(mgrTok, '/api/requests/2/decision', { method: 'POST', body: JSON.stringify({ outcome: 'approve' }) });
  check('manager approve 200', r.res.status === 200 && r.body.state === 'approved', JSON.stringify(r.body).slice(0, 120));
  r = await api(mgrTok, '/api/requests/2');
  check('attendance now reads claimed', r.body.evidence.source === 'regularisation', JSON.stringify(r.body.evidence));

  // --- calendar role check
  r = await api(empTok, '/api/calendar');
  check('employee calendar 403', r.res.status === 403 && r.body.error === 'Only managers and people operations read the calendar.');

  // --- queue filters and search
  r = await api(adminTok, '/api/requests?q=%');
  check('percent search literal', r.res.status === 200 && r.body.matched === 0);
  r = await api(adminTok, '/api/requests?q=' + 'x'.repeat(101));
  check('long search 400', r.res.status === 400 && r.body.error === 'Search is limited to 100 characters.');
  r = await api(adminTok, '/api/requests?state=whatever');
  check('bad state 400', r.res.status === 400 && r.body.error === 'Unknown state value: whatever.');
  r = await api(adminTok, '/api/requests?page=0');
  check('bad page 400', r.res.status === 400, JSON.stringify(r.body));
  r = await api(adminTok, '/api/requests?page=abc');
  check('malformed page 400', r.res.status === 400);

  // --- 404 / 405 / hostile ids
  r = await api(adminTok, '/api/nothing');
  check('unknown api 404', r.res.status === 404 && r.body.error === 'No such endpoint.');
  r = await api(adminTok, '/api/requests', { method: 'DELETE' });
  check('405 with allow', r.res.status === 405 && r.body.error === 'Method not allowed.' && (r.res.headers.get('allow') || '').includes('GET'), r.res.headers.get('allow'));
  for (const id of ['0', '-1', '01', '1.0', '1e3', '9223372036854775808', 'abc']) {
    r = await api(adminTok, `/api/requests/${id}`);
    check(`hostile id ${id} 404`, r.res.status === 404 && r.body.error === 'No such request.', JSON.stringify(r.body));
  }

  // --- policy
  r = await api(adminTok, '/api/policy');
  const etag = r.res.headers.get('etag');
  const currentVersion = r.body.version;
  check('policy readable', r.res.status === 200 && r.body.monthly_cap === 3 && r.body.lookback_days === 30, JSON.stringify(r.body));
  check('policy etag', etag === `"${currentVersion}"`, etag);

  r = await api(adminTok, '/api/policy', { method: 'PUT', body: JSON.stringify({ monthly_cap: 2, lookback_days: 30, enabled_types: ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'], require_note_on_approve: false }) });
  check('policy no If-Match 428', r.res.status === 428 && r.body.error === 'Send If-Match with the policy version you are changing.');

  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': '"99"' }, body: JSON.stringify({ monthly_cap: 2, lookback_days: 30, enabled_types: ['missed_in'], require_note_on_approve: false }) });
  check('policy stale 412', r.res.status === 412 && r.body.error.startsWith(`Version ${currentVersion} was saved after`), JSON.stringify(r.body));

  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 99, enabled_types: ['missed_in'], require_note_on_approve: false }) });
  check('policy field order 400 cap', r.res.status === 400 && r.body.error === 'monthly_cap must be a whole number from 0 to 10.' && r.body.field === 'monthly_cap', JSON.stringify(r.body));
  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 2, enabled_types: ['missed_in'], require_note_on_approve: false }) });
  check('policy missing lookback 400', r.res.status === 400 && r.body.error === 'lookback_days is required.' && r.body.field === 'lookback_days');
  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 2, lookback_days: 30, enabled_types: [], require_note_on_approve: false }) });
  check('policy empty types 400', r.res.status === 400 && r.body.error === 'At least one correction type must stay available.');
  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 2, lookback_days: 30, enabled_types: ['missed_in'], require_note_on_approve: false, self_approval_allowed: true }) });
  check('policy self approval 400', r.res.status === 400 && r.body.error === 'Not available. Self approval is refused by this product.' && r.body.field === 'self_approval_allowed');
  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 2, lookback_days: 30, enabled_types: ['missed_in'], require_note_on_approve: false, version: 5 }) });
  check('policy unpublished key 400', r.res.status === 400 && r.body.error === 'version cannot be set here.' && r.body.field === 'version');

  r = await api(adminTok, '/api/policy', { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ monthly_cap: 3, lookback_days: 30, enabled_types: ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'], require_note_on_approve: false }) });
  check('policy save 201 next version', r.res.status === 201 && r.body.version === currentVersion + 1, JSON.stringify(r.body));

  // --- trail verify and audit
  r = await api(adminTok, '/api/trail/verify');
  check('trail intact', r.res.status === 200 && r.body.intact === true, JSON.stringify(r.body));
  r = await api(adminTok, '/api/audit');
  check('audit readable', r.res.status === 200 && r.body.entries.length >= 9, 'len ' + r.body.entries.length);
  r = await api(mgrTok, '/api/audit');
  check('manager audit 403', r.res.status === 403 && r.body.error === 'Only people operations reads the whole trail.');
  r = await api(mgrTok, '/api/trail.csv');
  check('manager csv 403', r.res.status === 403 && r.body.error === 'Only people operations exports the trail.');
  const csvRes = await fetch(`${BASE}/api/trail.csv`, { headers: { authorization: `Bearer ${adminTok}` } });
  const csv = await csvRes.text();
  check('csv header', csvRes.status === 200 && csv.startsWith('seq,at,actor,actor_role,action,subject_type,subject_id,reason,detail,prev_hash,entry_hash\r\n'), csv.slice(0, 60));
  check('csv crlf ending', csv.endsWith('\r\n'));
  check('csv disposition', (csvRes.headers.get('content-disposition') || '').includes('attachment; filename="trail.csv"'), csvRes.headers.get('content-disposition'));

  r = await api(adminTok, '/api/policy/history');
  check('history grew', r.res.status === 200 && r.body.versions[0].version === currentVersion + 1, JSON.stringify(r.body).slice(0, 100));
  r = await api(mgrTok, '/api/policy/history');
  check('manager history 403', r.res.status === 403 && r.body.error === 'Only people operations reads the policy history.');

  // --- raise rules
  r = await api(empTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-10', correction_type: 'missed_in', claimed_in: '09:00', reason: 'short' }) });
  check('short reason 400', r.res.status === 400 && r.body.error === 'A reason needs at least twenty characters.', JSON.stringify(r.body));
  r = await api(empTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-13-45', correction_type: 'missed_in', claimed_in: '09:00', reason: 'A reason of at least twenty characters.' }) });
  check('bad day 400', r.res.status === 400 && r.body.error === 'day must read YYYY-MM-DD.');
  r = await api(empTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-10', correction_type: 'bogus', claimed_in: '09:00', reason: 'A reason of at least twenty characters.' }) });
  check('unknown type 400', r.res.status === 400 && r.body.error === 'Unknown correction type: bogus.');
  r = await api(empTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-10', correction_type: 'missed_in', reason: 'A reason of at least twenty characters.' }) });
  check('missing claimed_in 400', r.res.status === 400 && r.body.error === 'claimed_in is required.' && r.body.field === 'claimed_in');

  // admin cannot raise
  r = await api(adminTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: '2026-10-10', correction_type: 'missed_in', claimed_in: '09:00', reason: 'A reason of at least twenty characters.' }) });
  check('admin raise 403', r.res.status === 403 && r.body.error === 'People operations does not raise corrections.');

  // idempotency
  const idemKey = `test-key-${Date.now()}`;
  const idemDay = '2026-10-20';
  const raiseBody = { day: idemDay, correction_type: 'missed_out', claimed_out: '18:00', reason: 'Idempotency test reason of twenty characters.' };
  r = await api(empTok, '/api/requests', { method: 'POST', headers: { 'idempotency-key': idemKey }, body: JSON.stringify(raiseBody) });
  check('idem raise 201', r.res.status === 201, JSON.stringify(r.body).slice(0, 100));
  const raisedId = r.body.id;
  r = await api(empTok, '/api/requests', { method: 'POST', headers: { 'idempotency-key': idemKey }, body: JSON.stringify(raiseBody) });
  check('idem replay 200', r.res.status === 200 && r.body.id === raisedId && r.res.headers.get('idempotent-replayed') === 'true', JSON.stringify([r.res.status, r.res.headers.get('idempotent-replayed')]));
  r = await api(empTok, '/api/requests', { method: 'POST', headers: { 'idempotency-key': idemKey }, body: JSON.stringify({ ...raiseBody, reason: 'A different reason of twenty characters long.' }) });
  check('idem conflict 422', r.res.status === 422 && r.body.error === 'That idempotency key was already used for a different correction.');
  r = await api(empTok, '/api/requests', { method: 'POST', body: JSON.stringify({ day: idemDay, correction_type: 'missed_in', claimed_in: '09:00', reason: 'Second raise on a pending day should be refused.' }) });
  check('already pending 409', r.res.status === 409 && r.body.error === `You already have a correction waiting on ${idemDay}.`, JSON.stringify(r.body).slice(0, 120));
  await api(empTok, `/api/requests/${raisedId}/cancel`, { method: 'POST' });

  // share links
  r = await api(empTok, '/api/share-links', { method: 'POST', body: JSON.stringify({ person_id: 5, month: '2026-10' }) });
  check('employee mint 403', r.res.status === 403 && r.body.error === 'Only managers and people operations share a month.');
  r = await api(mgrTok, '/api/share-links', { method: 'POST', body: JSON.stringify({ person_id: 9, month: '2026-10' }) });
  check('manager mint other team 404', r.res.status === 404 && r.body.error === 'No such person.', JSON.stringify(r.body));
  r = await api(mgrTok, '/api/share-links', { method: 'POST', body: JSON.stringify({ person_id: 5, month: '2026-10' }) });
  check('manager mint own report 201', r.res.status === 201, JSON.stringify(r.body).slice(0, 150));
  const link = r.body;
  check('link token length', link.token && link.token.length >= 32, link.token?.length);
  const shareRes = await fetch(`${BASE}/share/${link.token}`);
  check('share page 200', shareRes.status === 200, shareRes.status);
  const shareRes2 = await fetch(`${BASE}/share/not-a-real-token-0000000000`);
  check('unknown share 404', shareRes2.status === 404, shareRes2.status);
  // replace the link by minting again
  r = await api(mgrTok, '/api/share-links', { method: 'POST', body: JSON.stringify({ person_id: 5, month: '2026-10' }) });
  check('remint 201', r.res.status === 201);
  const oldRes = await fetch(`${BASE}/share/${link.token}`);
  check('replaced link 410', oldRes.status === 410, oldRes.status);
  const link2 = r.body;
  r = await api(mgrTok, `/api/share-links/${link2.id}`, { method: 'DELETE' });
  check('revoke 204', r.res.status === 204, r.res.status);
  const revoked = await fetch(`${BASE}/share/${link2.token}`);
  check('revoked share 410', revoked.status === 410, revoked.status);
  r = await api(mgrTok, `/api/share-links/${link2.id}`, { method: 'DELETE' });
  check('re-revoke 409', r.res.status === 409 && r.body.error === 'That link no longer works.', JSON.stringify(r.body));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
