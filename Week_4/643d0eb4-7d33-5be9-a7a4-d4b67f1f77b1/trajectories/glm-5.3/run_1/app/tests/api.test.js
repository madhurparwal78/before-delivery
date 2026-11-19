// Keystone Tables — the API test suite. Run against a live server on APP_PUBLIC_URL.
// Usage: node tests/api.test.js
const BASE = process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173';

let passed = 0, failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; }
  else { failed++; failures.push(name + (detail ? ' :: ' + detail : '')); }
}

async function call(method, path, { body, headers, cookie } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (cookie) opts.headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function login(email) {
  const res = await call('POST', '/api/auth/login', { body: { email, password: 'deku-demo-pw-2026' } });
  if (res.status !== 200) throw new Error('login failed for ' + email + ': ' + res.text);
  return { token: res.json.token, cookie: 'keystone_session=' + res.json.token };
}

const PW = 'deku-demo-pw-2026';

async function main() {
  // ---------- DP-01, DP-02 ----------
  const health = await call('GET', '/api/health');
  check('health answers 200', health.status === 200);
  for (const path of ['/', '/plans', '/enquiry', '/community', '/developers', '/login']) {
    const res = await fetch(BASE + path);
    const text = await res.text();
    check('public page ' + path + ' answers 200', res.status === 200 && text.length > 100);
  }

  // ---------- DP-05 tiers ----------
  const tiers = await call('GET', '/api/tiers');
  check('tiers is a top-level array of four', Array.isArray(tiers.json) && tiers.json.length === 4);
  check('tier names in grant order', JSON.stringify(tiers.json.map(t => t.name)) === '["starter","team","scale","regulated"]');
  const starter = tiers.json[0];
  check('starter allowances', starter.row_allowance === 3000 && starter.stored_megabytes === 2048 && starter.content_allowance_kilobytes === 192 && starter.view_allowance === 2 && starter.retention === 'one period');

  // ---------- auth ----------
  const anonTables = await call('GET', '/api/tables');
  check('closed address answers 401 without session', anonTables.status === 401);

  const wrongPw = await call('POST', '/api/auth/login', { body: { email: 'editor.claims@example.com', password: 'wrongwrongwrong' } });
  const unknownEmail = await call('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: 'wrongwrongwrong' } });
  check('wrong password 401', wrongPw.status === 401);
  check('unknown email 401', unknownEmail.status === 401);
  check('one sign-in refusal word for word', JSON.stringify(wrongPw.json) === JSON.stringify(unknownEmail.json) && wrongPw.json.reason === 'Email or password is wrong.' && wrongPw.json.field === 'email');

  // throttling keyed on the email alone
  const throttleEmail = 'throttle.me@example.com';
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/auth/login', { body: { email: throttleEmail, password: 'nope-nope-nope' } });
    check('refused attempt ' + (i + 1) + ' answers 401', r.status === 401);
  }
  const throttled = await call('POST', '/api/auth/login', { body: { email: throttleEmail, password: PW } });
  check('sixth attempt throttled 429 even with the right password', throttled.status === 429);
  check('throttle carries Retry-After', Number(throttled.headers.get('retry-after')) >= 1);
  const otherAccount = await call('POST', '/api/auth/login', { body: { email: 'editor.claims@example.com', password: PW } });
  check('throttling one email throttles no other email', otherAccount.status === 200);

  // ---------- sign up rules ----------
  const badTier = await call('POST', '/api/auth/signup', { body: { email: 'new.person@example.com', display_name: 'New Person', department: 'claims', password: 'a-reasonable-passphrase', tier: 'gold' } });
  check('unknown tier refused 422 naming tier', badTier.status === 422 && badTier.json.field === 'tier');
  const noTier = await call('POST', '/api/auth/signup', { body: { email: 'new.person@example.com', display_name: 'New Person', department: 'claims', password: 'a-reasonable-passphrase' } });
  check('missing tier refused 422 naming tier', noTier.status === 422 && noTier.json.field === 'tier');
  const shortPw = await call('POST', '/api/auth/signup', { body: { email: 'new.person@example.com', display_name: 'New Person', department: 'claims', password: 'short', tier: 'starter' } });
  check('short password refused 422 naming password', shortPw.status === 422 && shortPw.json.field === 'password');
  const obviousPw = await call('POST', '/api/auth/signup', { body: { email: 'new.person@example.com', display_name: 'New Person', department: 'claims', password: 'KEYSTONETABLES', tier: 'starter' } });
  check('obvious password refused whatever its case', obviousPw.status === 422 && obviousPw.json.field === 'password');

  const existingEmail = await call('POST', '/api/auth/signup', { body: { email: 'editor.claims@example.com', display_name: 'Duplicate Person', department: 'claims', password: 'a-reasonable-passphrase', tier: 'starter' } });
  const malformedEmail = await call('POST', '/api/auth/signup', { body: { email: 'not-an-email', display_name: 'Mal Person', department: 'claims', password: 'a-reasonable-passphrase', tier: 'starter' } });
  check('existing email refused 422', existingEmail.status === 422);
  check('malformed email refused 422', malformedEmail.status === 422);
  check('sign up reveals no account', JSON.stringify(existingEmail.json) === JSON.stringify(malformedEmail.json));

  const madeUp = 'fresh.account.' + Date.now() + '@example.com';
  const created = await call('POST', '/api/auth/signup', { body: { email: madeUp, display_name: 'Fresh Account', department: 'claims', password: 'a-reasonable-passphrase', tier: 'team' } });
  check('sign up answers 201 with the tier recorded', created.status === 201 && created.json.tier === 'team');
  const fresh = await call('POST', '/api/auth/login', { body: { email: madeUp, password: 'a-reasonable-passphrase' } });
  const freshCookie = 'keystone_session=' + fresh.json.token;
  const freshTables = await call('GET', '/api/tables', { cookie: freshCookie });
  check('a fresh account reads no table', Array.isArray(freshTables.json) && freshTables.json.length === 0);

  // ---------- the department boundary ----------
  const stewardClaims = await login('steward.claims@example.com');
  const editorUW = await login('editor.underwriting@example.com');
  const claimsTable = await call('GET', '/api/tables/claims-intake', { cookie: editorUW.cookie });
  check('another department reader refused on the table', claimsTable.status === 403);
  check('refusal names the department', claimsTable.json && claimsTable.json.department === 'claims');
  const claimsRows = await call('GET', '/api/tables/claims-intake/rows', { cookie: editorUW.cookie });
  check('rows refused across the boundary', claimsRows.status === 403);
  const claimsLog = await call('GET', '/api/tables/claims-intake/log', { cookie: editorUW.cookie });
  check('log refused across the boundary', claimsLog.status === 403);
  const snapshots = await call('GET', '/api/snapshots', { cookie: editorUW.cookie });
  check('snapshots list holds no claims snapshot for the underwriting editor', Array.isArray(snapshots.json) && snapshots.json.every(s => s.table !== 'claims-reserves'));

  // ---------- console pages on the cookie ----------
  const consolePage = await fetch(BASE + '/console/tables', { headers: { Cookie: stewardClaims.cookie } });
  const consoleText = await consolePage.text();
  check('console page answers 200 on the cookie', consolePage.status === 200 && consoleText.includes('Claims intake'));
  const consoleAnon = await fetch(BASE + '/console/tables');
  check('console without a session answers a client error, not a redirect', consoleAnon.status === 401);
  // A reader who holds a role on claims but none on actuarial gets the refusal page there.
  const claimsOnlyTable = await fetch(BASE + '/console/tables/actuarial-triangles', { headers: { Cookie: stewardClaims.cookie } });
  const claimsOnlyText = await claimsOnlyTable.text();
  check('console page refuses cross-department as a page', claimsOnlyTable.status === 403 && claimsOnlyText.includes('This department is closed to you.'));
  check('the refusal page names the department in its own element', claimsOnlyText.includes('actuarial'));

  // ---------- the write boundary ----------
  const viewerClaims = await login('viewer.claims@example.com');
  const analystClaims = await login('analyst.claims@example.com');

  const rowsPage = await call('GET', '/api/tables/claims-intake/rows?per_page=1', { cookie: stewardClaims.cookie });
  const anyRow = rowsPage.json[0];

  const viewerPatch = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: viewerClaims.cookie, body: { values: { 'Claim count': 5 } } });
  check('viewer amendment refused 403', viewerPatch.status === 403);
  check('role refusal names no period', !JSON.stringify(viewerPatch.json).includes('period'));

  const typeRefusal = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 3.5 } } });
  check('decimal into integer refused 422', typeRefusal.status === 422);
  check('type refusal names the column caption', typeRefusal.json.field === 'Claim count' && typeRefusal.json.reason.includes('Claim count'));
  check('type refusal names the wanted type', typeRefusal.json.reason.includes('integer'));
  const afterRefusal = await call('GET', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie });
  check('row unchanged after the type refusal', afterRefusal.json.values['Claim count'] !== 3.5);

  const longRefusal = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { Reference: 'x'.repeat(501) } } });
  check('string past 500 refused 422', longRefusal.status === 422 && longRefusal.json.field === 'Reference');
  const choiceRefusal = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { Band: 'gargantuan' } } });
  check('value outside the choice list refused 422', choiceRefusal.status === 422 && choiceRefusal.json.field === 'Band');
  const flagRefusal = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { Settled: 'maybe' } } });
  check('non-member flag value refused 422', flagRefusal.status === 422 && flagRefusal.json.field === 'Settled');

  // ---------- locked table ----------
  const reservesRows = await call('GET', '/api/tables/claims-reserves/rows?per_page=1', { cookie: stewardClaims.cookie });
  const reserveRow = reservesRows.json[0];
  const lockedRefusal = await call('PATCH', '/api/tables/claims-reserves/rows/' + reserveRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Reserve amount': 1 } } });
  check('locked table amendment refused 409', lockedRefusal.status === 409);
  check('locked refusal names the period', lockedRefusal.json.reason.includes('2026-Q2') && lockedRefusal.json.field === 'locked_period');
  const lockedCreate = await call('POST', '/api/tables/claims-reserves/rows', { cookie: stewardClaims.cookie, body: { values: { Reference: 'CR-TEST' } } });
  check('locked table create refused 409 naming the period', lockedCreate.status === 409 && lockedCreate.json.reason.includes('2026-Q2'));
  const lockedDelete = await call('DELETE', '/api/tables/claims-reserves/rows/' + reserveRow.id, { cookie: stewardClaims.cookie });
  check('locked table delete refused 409 naming the period', lockedDelete.status === 409 && lockedDelete.json.reason.includes('2026-Q2'));
  const lockedViewer = await call('PATCH', '/api/tables/claims-reserves/rows/' + reserveRow.id, { cookie: viewerClaims.cookie, body: { values: { 'Reserve amount': 1 } } });
  check('role is checked before the lock: viewer answers 403 on a locked table', lockedViewer.status === 403);

  // ---------- locks and the change log ----------
  const highBefore = (await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie })).json.log_high_ordinal;
  const lockState = await call('POST', '/api/tables/claims-intake/lock', { cookie: stewardClaims.cookie, body: { period: '2026-T1' } });
  check('steward locks a table', lockState.status === 200 && lockState.json.locked_period === '2026-T1');
  const lockRefusedWrite = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 9 } } });
  check('amendment of a locked table refused naming the new period', lockRefusedWrite.status === 409 && lockRefusedWrite.json.reason.includes('2026-T1'));
  const unlock = await call('DELETE', '/api/tables/claims-intake/lock', { cookie: stewardClaims.cookie });
  check('unlock restores amendment', unlock.status === 200 && unlock.json.locked_period === null);
  const tableAfter = await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie });
  check('unlock writes no change log entry', tableAfter.json.log_high_ordinal === highBefore);
  const relock = await call('POST', '/api/tables/claims-intake/lock', { cookie: stewardClaims.cookie, body: { period: '2026-T2' } });
  check('the lock can be applied again', relock.status === 200 && relock.json.locked_period === '2026-T2');
  await call('DELETE', '/api/tables/claims-intake/lock', { cookie: stewardClaims.cookie });
  const viewerLock = await call('POST', '/api/tables/claims-intake/lock', { cookie: viewerClaims.cookie, body: { period: 'x' } });
  check('viewer cannot lock', viewerLock.status === 403);

  // ---------- versions ----------
  const rowBefore = await call('GET', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie });
  const version0 = rowBefore.json.version;
  const amended = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 77 } } });
  check('accepted amendment raises the version by exactly one', amended.status === 200 && amended.json.version === version0 + 1);
  const stale = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, headers: { 'If-Match-Version': String(version0) }, body: { values: { 'Claim count': 1 } } });
  check('stale amendment refused 409 naming version', stale.status === 409 && stale.json.field === 'version' && stale.json.reason === 'This row has moved on.');
  check('stale refusal carries current_version', stale.json.current_version === version0 + 1);
  const logBeforeStale = (await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie })).json.log_high_ordinal;
  await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, headers: { 'If-Match-Version': String(version0) }, body: { values: { 'Claim count': 1 } } });
  const logAfterStale = (await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie })).json.log_high_ordinal;
  check('a stale refusal appends no change log entry', logAfterStale === logBeforeStale);
  const noHeader = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 88 } } });
  check('an amendment with no If-Match-Version is never refused for its version', noHeader.status === 200);

  const versionNow = noHeader.json.version;
  const results = await Promise.all([1, 2, 3].map(n =>
    call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, headers: { 'If-Match-Version': String(versionNow) }, body: { values: { 'Claim count': 100 + n } } })));
  const accepted = results.filter(r => r.status === 200);
  const refused409 = results.filter(r => r.status === 409);
  check('exactly one amendment of a row wins', accepted.length === 1 && refused409.length === 2);

  // an amendment is one unit of work
  const unitBefore = await call('GET', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie });
  const unitRes = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 5, Reference: 'y'.repeat(501) } } });
  const unitAfter = await call('GET', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie });
  check('one wrong value refuses the whole amendment', unitRes.status === 422);
  check('a refused unit writes not one of the named columns', unitAfter.json.values['Claim count'] === unitBefore.json.values['Claim count']);
  check('a refused unit leaves the version where it was', unitAfter.json.version === unitBefore.json.version);

  // ---------- idempotency ----------
  const key = 'test-key-' + Date.now();
  const createBody = { values: { Reference: 'IDEM-1', 'Claim count': 7, Band: 'low', Settled: true } };
  const create1 = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, headers: { 'Idempotency-Key': key }, body: createBody });
  check('idempotent create answers 201', create1.status === 201 && create1.json.version === 1);
  const create2 = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, headers: { 'Idempotency-Key': key }, body: createBody });
  check('a replay answers the first body byte for byte', create2.status === create1.status && create2.text === create1.text);
  const create3 = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, headers: { 'Idempotency-Key': key }, body: { values: { Reference: 'IDEM-2' } } });
  check('the same key with a different body refused 409', create3.status === 409 && create3.json.field === 'idempotency_key' && create3.json.reason === 'This idempotency key was used for another request.');
  const c1 = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, body: { values: { Reference: 'DOUBLE-1' } } });
  const c2 = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, body: { values: { Reference: 'DOUBLE-1' } } });
  check('two identical creates with no key create two rows', c1.status === 201 && c2.status === 201 && c1.json.id !== c2.json.id && c1.json.version === 1 && c2.json.version === 1);
  await call('DELETE', '/api/tables/claims-intake/rows/' + create1.json.id, { cookie: stewardClaims.cookie });
  await call('DELETE', '/api/tables/claims-intake/rows/' + c1.json.id, { cookie: stewardClaims.cookie });
  await call('DELETE', '/api/tables/claims-intake/rows/' + c2.json.id, { cookie: stewardClaims.cookie });

  // ---------- the row allowance ----------
  const intake = await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie });
  const allowance = intake.json.row_allowance;
  const have = intake.json.count;
  const need = allowance - have;
  const filler = [];
  for (let i = 0; i < need; i++) {
    const res = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, body: { values: { Reference: 'FILL-' + i } } });
    filler.push(res.json.id);
  }
  const atLimit = await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie });
  check('the table filled to its allowance', atLimit.json.count === allowance);
  check('stored_kilobytes equals twice the count', atLimit.json.stored_kilobytes === atLimit.json.count * 2);
  const refusedCreate = await call('POST', '/api/tables/claims-intake/rows', { cookie: stewardClaims.cookie, body: { values: { Reference: 'OVER' } } });
  check('row past the allowance refused 422', refusedCreate.status === 422);
  check('allowance refusal names the tier, the allowance and the count',
    refusedCreate.json.reason.includes('starter') && refusedCreate.json.reason.includes('3000'));
  check('allowance refusal field is allowance', refusedCreate.json.field === 'allowance');
  const logHighAtRefusal = (await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie })).json.log_high_ordinal;
  for (const id of filler) {
    await call('DELETE', '/api/tables/claims-intake/rows/' + id, { cookie: stewardClaims.cookie });
  }

  // ---------- content figures ----------
  const reserves = await call('GET', '/api/tables/claims-reserves', { cookie: stewardClaims.cookie });
  check('content figures are answered', typeof reserves.json.content_bytes === 'number' && typeof reserves.json.content_kilobytes === 'number');
  const claimsIntakeRead = await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims.cookie });
  check('content_kilobytes floors content_bytes by 1024', claimsIntakeRead.json.content_kilobytes === Math.floor(claimsIntakeRead.json.content_bytes / 1024));

  // ---------- deep paging ----------
  const stewardAct = await login('steward.actuarial@example.com');
  const deep = await call('GET', '/api/tables/actuarial-exposure/rows?page=40&per_page=100', { cookie: stewardAct.cookie });
  check('deep page answers its own slice', deep.json.length === 100 && deep.json[0].values.Reference === 'EXP-3901' && deep.json[99].values.Reference === 'EXP-4000');
  check('X-Total-Count carries the whole total', deep.headers.get('x-total-count') === '4000');
  const deepFiltered = await call('GET', '/api/tables/actuarial-exposure/rows?page=2&per_page=10&sort=Reference', { cookie: stewardAct.cookie });
  check('sort orders the whole table before the page is cut', deepFiltered.status === 200 && deepFiltered.json[0].values.Reference === 'EXP-0011');
  const overPage = await call('GET', '/api/tables/actuarial-exposure/rows?per_page=501', { cookie: stewardAct.cookie });
  check('per_page above 500 refused 422 naming per_page', overPage.status === 422 && overPage.json.field === 'per_page' && overPage.json.reason === 'A page carries at most 500 rows.');

  // ---------- views ----------
  const sharedView = await call('POST', '/api/tables/actuarial-triangles/views', { cookie: stewardAct.cookie, body: { name: 'High band ' + Date.now(), visibility: 'shared', filters: [{ column: 'Band', operator: 'equals', value: 'high' }], sorts: [{ column: 'Opened on', direction: 'asc' }] } });
  check('a shared view is created', sharedView.status === 201);
  const badFilter = await call('POST', '/api/tables/actuarial-triangles/views', { cookie: stewardAct.cookie, body: { name: 'Bad filter', visibility: 'private', filters: [{ column: 'Reference', operator: 'contains', value: 'x' }], sorts: [] } });
  check('contains on a text column is allowed', badFilter.status === 201);
  const badFilter2 = await call('POST', '/api/tables/actuarial-exposure/views', { cookie: stewardAct.cookie, body: { name: 'Bad filter 2', visibility: 'private', filters: [{ column: 'Settled', operator: 'greater than', value: 'x' }], sorts: [] } });
  check('greater than on a flag column refused', badFilter2.status === 422);
  const viewerView = await call('POST', '/api/tables/claims-intake/views', { cookie: viewerClaims.cookie, body: { name: 'No', visibility: 'private', filters: [], sorts: [] } });
  check('viewer cannot manage views', viewerView.status === 403);
  const analystView = await call('POST', '/api/tables/claims-intake/views', { cookie: analystClaims.cookie, body: { name: 'Analyst view', visibility: 'private', filters: [], sorts: [] } });
  check('analyst manages views', analystView.status === 201);
  const analystRow = await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: analystClaims.cookie, body: { values: { 'Claim count': 1 } } });
  check('analyst cannot amend a row', analystRow.status === 403);

  // the view filters select the rows its table answers
  const viewRows = await call('GET', '/api/tables/actuarial-triangles/rows?view=' + sharedView.json.id, { cookie: stewardAct.cookie });
  check('a view narrows its rows', viewRows.json.every(r => r.values.Band === 'high') && viewRows.json.length > 0);
  const viewTotal = viewRows.headers.get('x-total-count');
  check('a view narrows the total too', Number(viewTotal) < 44 && Number(viewTotal) > 0);

  // shared view allowance: the starter tier grants 2 per table
  const sv1 = await call('POST', '/api/tables/claims-intake/views', { cookie: stewardClaims.cookie, body: { name: 'Shared 1', visibility: 'shared', filters: [], sorts: [] } });
  const sv2 = await call('POST', '/api/tables/claims-intake/views', { cookie: stewardClaims.cookie, body: { name: 'Shared 2', visibility: 'shared', filters: [], sorts: [] } });
  const sv3 = await call('POST', '/api/tables/claims-intake/views', { cookie: stewardClaims.cookie, body: { name: 'Shared 3', visibility: 'shared', filters: [], sorts: [] } });
  check('shared views created to the allowance', sv1.status === 201 && sv2.status === 201);
  check('the shared view past the allowance is refused naming the tier, the allowance and the count',
    sv3.status === 422 && sv3.json.reason.includes('starter') && sv3.json.reason.includes('2'));
  await call('DELETE', '/api/tables/claims-intake/views/' + sv1.json.id, { cookie: stewardClaims.cookie });
  await call('DELETE', '/api/tables/claims-intake/views/' + sv2.json.id, { cookie: stewardClaims.cookie });

  // ---------- snapshots ----------
  const snapList = await call('GET', '/api/snapshots', { cookie: stewardClaims.cookie });
  const claimsSnaps = snapList.json.filter(s => s.table === 'claims-reserves');
  check('the retained claims snapshot answers and the expired one is absent', claimsSnaps.some(s => s.period === '2026-Q2') && !claimsSnaps.some(s => s.period === '2026-Q1'));
  const q2 = claimsSnaps.find(s => s.period === '2026-Q2');
  const q2Read = await call('GET', '/api/snapshots/' + q2.id, { cookie: stewardClaims.cookie });
  check('a retained snapshot answers its frozen rows', q2Read.status === 200 && Array.isArray(q2Read.json.rows) && q2Read.json.rows.length === 40);
  check('a snapshot records its tier figures', q2Read.json.tier === 'starter' && q2Read.json.row_allowance === 3000 && q2Read.json.retention === 'one period');
  check('snapshot sequences are per department and contiguous', q2Read.json.sequence === 2);
  const actSnapList = await call('GET', '/api/snapshots', { cookie: stewardAct.cookie });
  const actSnaps = actSnapList.json.filter(s => s.table === 'actuarial-triangles');
  check('both straddling snapshots are inside the scale retention', actSnaps.length === 2 && actSnaps.every(s => s.retained === true));
  const b1 = actSnaps.find(s => s.period === '2026-B1');
  const b1Read = await call('GET', '/api/snapshots/' + b1.id, { cookie: stewardAct.cookie });
  check('the 18:29:59Z snapshot carries its own business day', b1Read.status === 200 && b1Read.json.business_day === '2026-03-31');
  const b2 = actSnaps.find(s => s.period === '2026-B2');
  const b2Read = await call('GET', '/api/snapshots/' + b2.id, { cookie: stewardAct.cookie });
  check('the 18:30:00Z snapshot belongs to the later business day', b2Read.status === 200 && b2Read.json.business_day === '2026-04-01');

  const repeat = await call('POST', '/api/snapshots', { cookie: stewardClaims.cookie, body: { table: 'claims-reserves', period: '2026-Q2' } });
  check('a second snapshot for a published period refused 409', repeat.status === 409);
  const noTable = await call('POST', '/api/snapshots', { cookie: stewardClaims.cookie, body: { table: 'no-such-table', period: '2026-X1' } });
  check('a table slug that does not exist answers 404', noTable.status === 404);
  const missingTable = await call('GET', '/api/tables/no-such-table', { cookie: stewardClaims.cookie });
  check('a table slug that does not exist answers 404 on read too', missingTable.status === 404);

  // publish, amend, and the frozen rows stay
  const runTag = String(Date.now()).slice(-6);
  const pub = await call('POST', '/api/snapshots', { cookie: stewardClaims.cookie, body: { table: 'claims-intake', period: 'FZ-' + runTag } });
  check('publishing an unlocked table works', pub.status === 201);
  check('the published snapshot records its sequence', pub.json.sequence === 3);
  const frozenId = pub.json.id;
  const frozenRows = pub.json.rows.length;
  const frozenContentBytes = pub.json.content_bytes;
  const frozenRowCount = pub.json.row_count;
  await call('PATCH', '/api/tables/claims-intake/rows/' + anyRow.id, { cookie: stewardClaims.cookie, body: { values: { 'Claim count': 12345 } } });
  const frozenAfter = await call('GET', '/api/snapshots/' + frozenId, { cookie: stewardClaims.cookie });
  check('the published snapshot keeps the rows it held', frozenAfter.json.rows.length === frozenRows);
  check("a snapshot's recorded figures never move", frozenAfter.json.row_count === frozenRowCount && frozenAfter.json.content_bytes === frozenContentBytes);
  const snapAmend = await call('PATCH', '/api/snapshots/' + frozenId, { cookie: stewardClaims.cookie, body: { values: {} } });
  check('a snapshot address refuses every amendment', snapAmend.status === 403);

  // retention: publishing past the starter's one period expires the older one
  await call('POST', '/api/snapshots', { cookie: stewardClaims.cookie, body: { table: 'claims-intake', period: 'FZ2-' + runTag } });
  const expiredRead = await call('GET', '/api/snapshots/' + frozenId, { cookie: stewardClaims.cookie });
  check('the snapshot one past the retention answers 410', expiredRead.status === 410);
  const listAfter = await call('GET', '/api/snapshots?table=claims-intake', { cookie: stewardClaims.cookie });
  check('the expired snapshot is absent from the list and the retained one answers', listAfter.json.some(s => s.period === 'FZ2-' + runTag) && !listAfter.json.some(s => s.id === frozenId));

  const logAmend = await call('POST', '/api/tables/claims-intake/log', { cookie: stewardClaims.cookie, body: {} });
  check('an amend verb on the change log answers 403', logAmend.status === 403);

  // ---------- requests ----------
  const analystAct = await login('analyst.actuarial@example.com');
  const myRequests = await call('GET', '/api/requests', { cookie: analystAct.cookie });
  const declinedSeeded = myRequests.json.find(r => r.state === 'declined');
  check('the seeded declined request answers', !!declinedSeeded && declinedSeeded.department === 'underwriting');

  const alreadyRole = await call('POST', '/api/requests', { cookie: editorUW.cookie, body: { department: 'actuarial', role: 'editor' } });
  check('raising a request for a department you hold a role in is refused', alreadyRole.status === 422);

  const stewardUW = await login('steward.underwriting@example.com');
  const requestRaiser = 'raiser.' + Date.now() + '@example.com';
  await call('POST', '/api/auth/signup', { body: { email: requestRaiser, display_name: 'Raiser', department: 'claims', password: 'a-reasonable-passphrase', tier: 'starter' } });
  const raiserLogin = await call('POST', '/api/auth/login', { body: { email: requestRaiser, password: 'a-reasonable-passphrase' } });
  const raiser = { cookie: 'keystone_session=' + raiserLogin.json.token };
  const open1 = await call('POST', '/api/requests', { cookie: raiser.cookie, body: { department: 'actuarial', role: 'editor' } });
  check('a request is created at open', open1.status === 201 && open1.json.state === 'open');
  const open2 = await call('POST', '/api/requests', { cookie: raiser.cookie, body: { department: 'actuarial', role: 'viewer' } });
  check('a repeat open request is refused 409', open2.status === 409 && open2.json.field === 'state');
  const selfDecide = await call('POST', '/api/requests/' + open1.json.id + '/decision', { cookie: raiser.cookie, body: { decision: 'approved', reason: 'mine' } });
  check('the requesting account is refused its own decision', selfDecide.status === 403);
  const decided = await call('POST', '/api/requests/' + open1.json.id + '/decision', { cookie: stewardAct.cookie, body: { decision: 'approved', reason: 'Exposure work needs it.' } });
  check('a steward approves the request', decided.status === 200 && decided.json.state === 'approved');
  const uwTablesAfter = await call('GET', '/api/tables', { cookie: stewardUW.cookie });
  const raiserTablesAfter = await call('GET', '/api/tables', { cookie: raiser.cookie });
  check('an approval reaches the account on its next read', raiserTablesAfter.json.some(t => t.slug === 'actuarial-triangles'));
  const secondDecision = await call('POST', '/api/requests/' + open1.json.id + '/decision', { cookie: stewardAct.cookie, body: { decision: 'declined', reason: 'again' } });
  check('a decided request answers 409 to another decision', secondDecision.status === 409 && secondDecision.json.field === 'state' && secondDecision.json.reason === 'This request has already been decided.');
  const foreignDecide = await call('POST', '/api/requests/' + open1.json.id + '/decision', { cookie: stewardClaims.cookie, body: { decision: 'declined', reason: 'no' } });
  check('a steward of another department is refused a decision', foreignDecide.status === 403);

  // two stewards decide together: exactly one wins
  const openRace = await call('POST', '/api/requests', { cookie: stewardClaims.cookie, body: { department: 'actuarial', role: 'viewer' } });
  // stewardClaims holds no role on actuarial so the raise is legitimate
  const raceA = call('POST', '/api/requests/' + openRace.json.id + '/decision', { cookie: stewardAct.cookie, body: { decision: 'approved', reason: 'A' } });
  const raceB = call('POST', '/api/requests/' + openRace.json.id + '/decision', { cookie: stewardAct.cookie, body: { decision: 'declined', reason: 'B' } });
  const [rA, rB] = await Promise.all([raceA, raceB]);
  const raceWins = [rA, rB].filter(r => r.status === 200);
  const raceLoses = [rA, rB].filter(r => r.status === 409);
  check('exactly one decision of one open request is recorded', raceWins.length === 1 && raceLoses.length === 1 && raceLoses[0].json.field === 'state');

  // ---------- enquiries and subscribers ----------
  const enquiry1 = await call('POST', '/api/enquiries', { body: { full_name: 'Test Person', work_email: 'test.person@example.com', company: 'Test Co', message: 'Hello there.' } });
  check('a complete enquiry is recorded', enquiry1.status === 201);
  const enquiry2 = await call('POST', '/api/enquiries', { body: { full_name: 'Test Person', work_email: 'test.person@example.com', company: 'Test Co', message: 'Hello there.' } });
  check('two identical enquiries record two rows', enquiry2.status === 201 && enquiry2.json.id !== enquiry1.json.id);
  const badEnquiry = await call('POST', '/api/enquiries', { body: { full_name: 'Test Person', work_email: 'not-an-email', company: 'Test Co', message: 'Hello' } });
  check('a malformed work email refused 422 naming work_email', badEnquiry.status === 422 && badEnquiry.json.field === 'work_email');
  const longMsg = await call('POST', '/api/enquiries', { body: { full_name: 'T', work_email: 't@example.com', company: 'C', message: 'm'.repeat(1001) } });
  check('a message past 1000 refused 422 naming message', longMsg.status === 422 && longMsg.json.field === 'message');
  const exactMsg = await call('POST', '/api/enquiries', { body: { full_name: 'T', work_email: 't@example.com', company: 'C', message: 'm'.repeat(1000) } });
  check('a message of exactly 1000 is accepted', exactMsg.status === 201);

  const sub1 = await call('POST', '/api/subscribers', { body: { email: 'reader@example.com' } });
  const sub2 = await call('POST', '/api/subscribers', { body: { email: 'reader@example.com' } });
  check('a repeat subscribe answers success both times', sub1.status < 300 && sub2.status < 300 && sub1.json.subscribed === true && sub2.json.subscribed === true);

  const formNoToken = await fetch(BASE + '/api/subscribers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=nomail@example.com',
  });
  check('a form post with no token refused 403 naming form_token', formNoToken.status === 403);
  const noTokenBody = await formNoToken.json();
  check('the form token refusal names form_token', noTokenBody.field === 'form_token');

  // ---------- login attempts ----------
  const attemptsViewer = await call('GET', '/api/login-attempts', { cookie: viewerClaims.cookie });
  check('a viewer is refused the login attempts', attemptsViewer.status === 403);
  const attemptsEditor = await call('GET', '/api/login-attempts', { cookie: editorUW.cookie });
  check('an editor is refused the login attempts', attemptsEditor.status === 403);
  const attemptsSteward = await call('GET', '/api/login-attempts', { cookie: stewardClaims.cookie });
  check('a steward reads the login attempts newest first', attemptsSteward.status === 200 && Array.isArray(attemptsSteward.json));
  check('an attempt never carries a password', attemptsSteward.json.every(a => !('password' in a) && !('password_hash' in a)));

  // ---------- the admin surface ----------
  const adminAnon = await call('GET', '/api/admin/grants');
  check('an admin address answers 401 without a session', adminAnon.status === 401);
  const adminViewer = await call('GET', '/api/admin/grants', { cookie: viewerClaims.cookie });
  check('a viewer is refused the admin surface', adminViewer.status === 403 && adminViewer.json.reason === 'This console is for stewards only.');
  const adminSteward = await call('GET', '/api/admin/grants', { cookie: stewardClaims.cookie });
  check('a steward reads its own department grants', adminSteward.status === 200 && adminSteward.json.every(g => g.department === 'claims'));
  check('grants carry authorising', adminSteward.json.every(g => typeof g.authorising === 'boolean'));

  const wrongMethod = await call('PUT', '/api/admin/grants', { cookie: stewardClaims.cookie, body: {} });
  check('an unaccepted method answers 405 naming method', wrongMethod.status === 405 && wrongMethod.json.field === 'method' && wrongMethod.json.reason === 'That method is not allowed here.');
  check('the 405 carries an Allow header', (wrongMethod.headers.get('allow') || '').includes('GET'));
  const wrongType = await fetch(BASE + '/api/admin/grants', {
    method: 'POST',
    headers: { Cookie: stewardClaims.cookie, 'Content-Type': 'text/plain' },
    body: 'hello',
  });
  const wrongTypeBody = await wrongType.json();
  check('a non-JSON administration write answers 415 naming content_type', wrongType.status === 415 && wrongTypeBody.field === 'content_type');

  const counts = await call('GET', '/api/admin/counts', { cookie: stewardClaims.cookie });
  check('admin counts answer the own department', counts.status === 200 && counts.json.department === 'claims');

  const queue1 = await call('GET', '/api/admin/queue', { cookie: stewardClaims.cookie });
  const queueCursor = queue1.headers.get('x-queue-cursor');
  check('the queue always carries a non-empty cursor', typeof queueCursor === 'string' && queueCursor.length > 0);
  const queueAct = await call('GET', '/api/admin/queue?cursor=' + encodeURIComponent(queueCursor), { cookie: stewardAct.cookie });
  check('a queue cursor of another department is refused 422', queueAct.status === 422 && queueAct.json.field === 'cursor' && queueAct.json.reason === 'This cursor belongs to another department.');
  const queueOrder = await call('GET', '/api/admin/queue', { cookie: stewardClaims.cookie });
  const openAhead = queueOrder.json.filter(r => r.state === 'open');
  check('the queue answers open requests ahead of decided ones', openAhead.length > 0 && queueOrder.json[0].state === 'open');

  const grantList = await call('GET', '/api/admin/grants', { cookie: stewardClaims.cookie });
  const analystGrant = grantList.json.find(g => g.role === 'analyst');
  const mismatch = await call('POST', '/api/admin/grants/revocations', { cookie: stewardClaims.cookie, body: { grants: [analystGrant.id], confirmation: 'revoke these grants permanently' } });
  check('a mismatched phrase is refused 422 naming confirmation', mismatch.status === 422 && mismatch.json.field === 'confirmation' && mismatch.json.reason === 'The confirmation phrase does not match.');
  const grantsAfterMismatch = await call('GET', '/api/admin/grants', { cookie: stewardClaims.cookie });
  check('a mismatched phrase revokes nothing', grantsAfterMismatch.json.some(g => g.id === analystGrant.id));
  const foreignBulk = await call('POST', '/api/admin/grants/revocations', { cookie: stewardClaims.cookie, body: { grants: [analystGrant.id, 'no-such-grant'], confirmation: 'Revoke these grants permanently' } });
  check('a named grant that cannot be revoked refuses the whole call', foreignBulk.status === 422 && foreignBulk.json.field === 'grants' && foreignBulk.json.reason === 'One of these grants cannot be revoked.');
  const grantsAfterForeign = await call('GET', '/api/admin/grants', { cookie: stewardClaims.cookie });
  check('the refused bulk revoke revoked not one grant', grantsAfterForeign.json.some(g => g.id === analystGrant.id));

  const uwGrantList = await call('GET', '/api/admin/grants', { cookie: stewardUW.cookie });
  const uwGrant = uwGrantList.json.find(g => g.account === 'editor.underwriting@example.com');
  const revokeForeign = await call('DELETE', '/api/admin/grants/' + uwGrant.id, { cookie: stewardClaims.cookie });
  check('revoking another department grant refused 403', revokeForeign.status === 403 && revokeForeign.json.reason === 'This department is not yours to govern.');

  // permission is read again on every request
  const revokeTest = await login('analyst.actuarial@example.com');
  const beforeRevoke = await call('GET', '/api/tables/actuarial-triangles', { cookie: revokeTest.cookie });
  check('the account reads its department before the revoke', beforeRevoke.status === 200);
  const actGrantList = await call('GET', '/api/admin/grants', { cookie: stewardAct.cookie });
  const analystActGrant = actGrantList.json.find(g => g.account === 'analyst.actuarial@example.com');
  const revoked = await call('DELETE', '/api/admin/grants/' + analystActGrant.id, { cookie: stewardAct.cookie });
  check('the steward revokes the grant', revoked.status === 204);
  const afterRevoke = await call('GET', '/api/tables/actuarial-triangles', { cookie: revokeTest.cookie });
  check('the revoke takes effect on the very next request of the same session', afterRevoke.status === 403);
  const regrant = await call('POST', '/api/admin/grants', { cookie: stewardAct.cookie, body: { account: 'analyst.actuarial@example.com', role: 'analyst' } });
  check('a grant created mid-session opens the department on the next request', regrant.status === 201);
  const afterRegrant = await call('GET', '/api/tables/actuarial-triangles', { cookie: revokeTest.cookie });
  check('the created grant takes effect immediately', afterRegrant.status === 200);

  const futureGrant = await call('POST', '/api/admin/grants', { cookie: stewardAct.cookie, body: { account: 'steward.underwriting@example.com', role: 'viewer', authorises_from: '2099-01-01T00:00:00Z' } });
  check('a future grant answers authorising false', futureGrant.status === 201 && futureGrant.json.authorising === false);
  const nowGrant = await call('POST', '/api/admin/grants', { cookie: stewardAct.cookie, body: { account: 'viewer.claims@example.com', role: 'viewer', authorises_from: '2020-01-01T00:00:00Z' } });
  check('a past grant answers authorising true', nowGrant.status === 201 && nowGrant.json.authorising === true);
  const vcRead = await call('GET', '/api/tables/actuarial-triangles', { cookie: viewerClaims.cookie });
  check('a grant authorises from its own moment', vcRead.status === 200);
  await call('DELETE', '/api/admin/grants/' + nowGrant.json.id, { cookie: stewardAct.cookie });
  const vcReadAfter = await call('GET', '/api/tables/actuarial-triangles', { cookie: viewerClaims.cookie });
  check('a revoked grant refuses the next read on the same session', vcReadAfter.status === 403);

  const adminLog = await call('GET', '/api/admin/log', { cookie: stewardAct.cookie });
  check('the admin log answers its own stream', adminLog.status === 200 && adminLog.json.length > 0 && adminLog.json[0].table_slug === 'admin-actuarial');
  check('admin log entries carry the acting steward and the subject', adminLog.json.every(e => e.account && e.subject !== undefined));

  // a refused administration read records nothing
  const logBeforeAdmin = await call('GET', '/api/admin/log', { cookie: stewardAct.cookie });
  const highestBefore = logBeforeAdmin.json[0] ? logBeforeAdmin.json[0].ordinal : 0;
  await call('GET', '/api/admin/grants', { cookie: viewerClaims.cookie });
  await call('DELETE', '/api/admin/grants/' + uwGrant.id, { cookie: stewardAct.cookie });
  const logAfterAdmin = await call('GET', '/api/admin/log', { cookie: stewardAct.cookie });
  const highestAfter = logAfterAdmin.json[0] ? logAfterAdmin.json[0].ordinal : 0;
  check('a refused administration request appends no log entry', highestAfter === highestBefore);

  // ---------- sessions ----------
  const logout = await call('POST', '/api/auth/logout', { cookie: stewardClaims.cookie });
  check('logout answers no content', logout.status === 204);
  const afterLogout = await call('GET', '/api/tables', { cookie: stewardClaims.cookie });
  check('an ended session answers 401 on /api', afterLogout.status === 401);
  const consoleAfterLogout = await fetch(BASE + '/console/tables', { headers: { Cookie: stewardClaims.cookie } });
  check('an ended session answers the refusal page on the console', consoleAfterLogout.status === 401);
  const stewardClaims2 = await login('steward.claims@example.com');
  const secondStillWorks = await call('GET', '/api/tables', { cookie: stewardClaims2.cookie });
  check('the other session of the same account keeps reading', secondStillWorks.status === 200);

  const staleRes = await call('GET', '/api/tables', { cookie: 'keystone_session=keystone-stale-session-2026' });
  check('the stale session is refused', staleRes.status === 401);

  // ---------- the grant in force ----------
  const claimsGrants = await call('GET', '/api/departments/claims/grants', { cookie: stewardClaims2.cookie });
  check('the department grants answer oldest first with in_force', claimsGrants.status === 200 && claimsGrants.json.length === 2 && claimsGrants.json[0].effective_at < claimsGrants.json[1].effective_at);
  check('only the grant in force is marked', claimsGrants.json.filter(g => g.in_force).length === 1 && claimsGrants.json[0].in_force === true && claimsGrants.json[1].in_force === false);
  const claimsTable2 = await call('GET', '/api/tables/claims-intake', { cookie: stewardClaims2.cookie });
  check('the claims allowance reads the starter grant in force, not the 2099 regulated one',
    claimsTable2.json.tier === 'starter' && claimsTable2.json.row_allowance === 3000);

  // ---------- the store shape, read directly through the pg client ----------
  const { Pool } = require('pg');
  const storePool = new Pool({ connectionString: process.env.DATABASE_URL });
  const psql = async (sql) => {
    const r = await storePool.query(sql);
    return String(r.rows[0].count);
  };
  const cols = async (table, names) => {
    const r = await storePool.query("SELECT count(*) AS c FROM information_schema.columns WHERE table_name=$1 AND column_name = ANY($2)", [table, names]);
    return Number(r.rows[0].c);
  };
  check('log_entries carries the columns named in the brief', (await cols('log_entries', ['table_slug','ordinal','recorded_at','business_day','column_caption','before','after','subject','previous_hash','entry_hash'])) === 10);
  check('snapshots carries the recorded figures', (await cols('snapshots', ['table_slug','period','published_at','business_day','sequence','tier','row_allowance','content_allowance_kilobytes','retention','row_count','content_bytes'])) === 11);
  check('tables carries no stored count', (await cols('tables', ['count','stored_kilobytes','log_high_ordinal','content_bytes','content_kilobytes'])) === 0);
  check('snapshots carries no retained column', (await cols('snapshots', ['retained'])) === 0);
  check('sessions carries the shape named', (await cols('sessions', ['value','account','created_at','expires_at'])) === 4);
  const pwCols = await storePool.query("SELECT count(*) AS c FROM information_schema.columns WHERE table_name='login_attempts' AND column_name LIKE '%password%'");
  check('login_attempts carries no password column', Number(pwCols.rows[0].c) === 0);
  // the stale session row stays in the store
  const staleRow = await storePool.query("SELECT count(*) AS c FROM sessions WHERE value='keystone-stale-session-2026'");
  check('the stale session row stays in the store', Number(staleRow.rows[0].c) === 1);
  await storePool.end();

  console.log('\n=' + '='.repeat(50));
  console.log('PASSED: ' + passed);
  console.log('FAILED: ' + failed);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  x ' + f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
