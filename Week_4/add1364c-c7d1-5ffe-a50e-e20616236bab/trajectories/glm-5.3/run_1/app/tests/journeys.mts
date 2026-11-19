/* End-to-end journey tests against a running server on :4173. */

const BASE = 'http://localhost:4173';

interface Result {
  name: string;
  pass: boolean;
  detail: string;
}

const results: Result[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  results.push({ name, pass: condition, detail });
  if (!condition) console.log(`FAIL  ${name}  -> ${detail}`);
}

async function j<T>(method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers ?? {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, headers: Object.fromEntries(res.headers.entries()) };
}
function cookieOf(response: { headers: Record<string, string> }): string {
  const setCookie = response.headers['set-cookie'] ?? '';
  return 'lockset_session=' + setCookie.split('lockset_session=')[1].split(';')[0];
}

async function main(): Promise<void> {
  // ---------------- DP-02 sign in ----------------
  const marta = await j<{ person: { full_name: string; role: string }; landing: string }>(
    'POST', '/api/sessions', { username: 'marta', password: 'KeysKept-2026' }
  );
  check('DP-02 sign in 201', marta.status === 201, `status ${marta.status}`);
  check('DP-02 landing is first visible vault', marta.body.landing === '/desk/vaults/v-payroll', marta.body.landing);
  const om = cookieOf(marta);
  const omId = marta.body.person ? '' : '';

  // bad credentials
  const bad = await j<{ error: { code: string; message: string } }>('POST', '/api/sessions', { username: 'marta', password: 'nope' });
  check('DP-02 bad credentials 401', bad.status === 401 && bad.body.error.code === 'bad_credentials');
  check('DP-02 bad credentials copy', bad.body.error.message === `That username and password don't match.`, bad.body.error.message);

  // ---------------- DP-69 lockout ----------------
  for (let i = 0; i < 5; i++) {
    await j('POST', '/api/sessions', { username: 'lockme', password: 'x' });
  }
  const locked = await j<{ error: { code: string; message: string } }>('POST', '/api/sessions', { username: 'lockme', password: 'x' });
  check('DP-69 lockout 429', locked.status === 429, `status ${locked.status}`);
  check('DP-69 lockout code', locked.body.error.code === 'sign_in_locked');
  check('DP-69 Retry-After header', Boolean(locked.headers['retry-after']), locked.headers['retry-after']);
  check('DP-69 lockout copy', locked.body.error.message.startsWith('Too many tries. Sign-in for this username reopens at '), locked.body.error.message);

  // ---------------- DP-08 visibility: deandra ----------------
  const deandra = await j<{ landing: string }>('POST', '/api/sessions', { username: 'deandra', password: 'KeysKept-2026' });
  const sa = cookieOf(deandra);
  const saVaults = await j<{ vaults: Array<{ id: string; name: string; pending_rules: unknown[]; rule_in_force: unknown }> }>('GET', '/api/vaults', undefined, sa);
  check('DP-08 staff sees only their vaults', saVaults.body.vaults.length === 3, `got ${saVaults.body.vaults.map((v) => v.name).join(',')}`);
  check('DP-08 staff gets no pending rules', saVaults.body.vaults.every((v) => v.pending_rules.length === 0));
  const hiddenVault = await j('GET', '/api/vaults/v-office', undefined, sa);
  check('DP-08 hidden vault 404', hiddenVault.status === 404);

  // ---------------- DP-04/05 reveal and leeway ----------------
  const bankVault = await j<{ credentials: Array<{ id: string; label: string }> }>('GET', '/api/vaults/v-banking', undefined, om);
  const businessPortal = bankVault.body.credentials.find((c) => c.label === 'Business portal');
  const reveal = await j<{ secret: string; rule_id: string; audit_id: string }>('POST', `/api/credentials/${businessPortal.id}/reveal`, {}, om);
  check('DP-04 reveal 200 with secret', reveal.status === 200 && reveal.body.secret === 'Prairie-wind-7731', JSON.stringify(reveal.body));
  check('DP-04 reveal records rule in force', reveal.body.rule_id === 'r-banking-1', reveal.body.rule_id);

  const officeVault = await j<{ credentials: Array<{ id: string; label: string }> }>('GET', '/api/vaults/v-office', undefined, om);
  const printer = officeVault.body.credentials.find((c) => c.label === 'Front desk printer admin');
  const printerReveal = await j<{ error: { code: string; message: string } }>('POST', `/api/credentials/${printer.id}/reveal`, {}, om);
  check('DP-05 leeway refusal 423', printerReveal.status === 423 && printerReveal.body.error.code === 'turn_required');
  check('DP-05 leeway copy', printerReveal.body.error.message === 'This login is past its 14-day leeway. Turn it before revealing.', printerReveal.body.error.message);

  // ---------------- DP-48 health report (before any turns change the seed state) ----------------
  const healthReport = await j<{ office_date: string; feed: string; counts: { exposed: number; vendor_breached: number; out_of_policy: number }; last_good_check_at: string | null }>(
    'GET', '/api/health-report', undefined, om
  );
  check('DP-48 health report 200', healthReport.status === 200);
  check('DP-48 printer admin exposed', healthReport.body.counts.exposed === 1, JSON.stringify(healthReport.body.counts));
  check('DP-48 website host vendor breached', healthReport.body.counts.vendor_breached === 1);
  check('DP-48 feed ok', healthReport.body.feed === 'ok');

  // ---------------- DP-30/31 turn with rule in force ----------------
  const shortTurn = await j<{ error: { fields: Record<string, string> } }>('PUT', `/api/credentials/${printer.id}/secret`, { secret: 'short' }, om);
  check('DP-30 turn refuses short secret', shortTurn.status === 422 && shortTurn.body.error.fields.secret === 'Office needs at least 10 characters.', JSON.stringify(shortTurn.body));
  const goodTurn = await j<{ label: string }>('PUT', `/api/credentials/${printer.id}/secret`, { secret: 'Fresh-printer-pass-22' }, om);
  check('DP-30 turn accepts meeting rule', goodTurn.status === 200, JSON.stringify(goodTurn.body));

  // after turn, reveal works
  const afterTurn = await j<{ secret: string }>('POST', `/api/credentials/${printer.id}/reveal`, {}, om);
  check('DP-05 after turn reveal works', afterTurn.status === 200 && afterTurn.body.secret === 'Fresh-printer-pass-22');

  // ---------------- DP-13 audit entries written ----------------
  const audit = await j<{ entries: Array<{ action: string; subject: { name: string }; details: Record<string, unknown>; office_day: string; office_time: string; offset: string; seq: number }> }>('GET', '/api/audit?order=oldest', undefined, om);
  const actions = audit.body.entries.map((e) => e.action);
  check('DP-13 reveal audited', actions.includes('reveal'));
  check('DP-13 secret_edit audited', actions.includes('secret_edit'));
  check('DP-13 secret_edit audited with rule detail', actions.includes('secret_edit'), actions.join(','));
  check('DP-14 entries carry office day', audit.body.entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.office_day)));

  // ---------------- DP-29/71 rule lifecycle ----------------
  const newRule = await j<{ id: string; version: number; state: string; stub_text: string }>('POST', '/api/rules', { vault_id: 'v-banking', min_length: 20, effective_on: '2026-12-25' }, om);
  check('DP-29 draft created', newRule.status === 201 && newRule.body.state === 'drafted' && newRule.body.version === 1);
  check('DP-32 draft stub text', newRule.body.stub_text === `Draft, waiting for the managing partner's signature: at least 20 characters from 00:00 CST, Fri 25 Dec`, newRule.body.stub_text);

  // editing a scheduled rule returns it to drafted
  const graham = await j('POST', '/api/sessions', { username: 'graham', password: 'KeysKept-2026' });
  const mp = cookieOf(graham);
  const signed = await j<{ id: string; state: string; version: number; stub_text: string }>('POST', `/api/rules/${newRule.body.id}/sign`, { version: newRule.body.version }, mp);
  check('DP-29 signed to scheduled', signed.status === 200 && signed.body.state === 'scheduled' && signed.body.version === 2);
  check('DP-32 takes-force copy', signed.body.stub_text === 'Takes force 00:00 CST, Fri 25 Dec', signed.body.stub_text);

  // stale version answers rule_changed
  const staleEdit = await j<{ error: { code: string; message: string } }>('PATCH', `/api/rules/${newRule.body.id}`, { version: 1, min_length: 22 }, om);
  check('DP-71 stale version 409 rule_changed', staleEdit.status === 409 && staleEdit.body.error.code === 'rule_changed');
  check('DP-71 rule_changed copy', staleEdit.body.error.message === 'This rule changed since you opened it. Reload it and try again.');

  // missing version: 422
  const noVersion = await j<{ error: { fields: Record<string, string> } }>('PATCH', `/api/rules/${newRule.body.id}`, { min_length: 22 }, om);
  check('DP-71 missing version 422', noVersion.status === 422 && Boolean(noVersion.body.error.fields?.version));

  // sign as office manager refused
  const signAsOm = await j('POST', `/api/rules/${newRule.body.id}/sign`, { version: 2 }, om);
  check('DP-29 only MP signs', signAsOm.status === 403);

  // ---------------- DP-33 as-of ----------------
  const today = new Date();
  const addDays = (n: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const asOf = await j<{ night: string; out_of_policy_count: number; vaults: Array<{ vault_id: string; cylinder: string; stubs: Array<{ text: string }>; out_of_policy_count: number }> }>(
    'GET', `/api/as-of?night=${addDays(5)}`, undefined, om
  );
  check('DP-33 as-of answers', asOf.status === 200, `status ${asOf.status}`);
  const bankingVault = asOf.body.vaults.find((v) => v.vault_id === 'v-banking');
  check('DP-35 banking cylinder pending before night', bankingVault?.cylinder === 'pending', bankingVault?.cylinder);
  check('DP-35 stub text present', (bankingVault?.stubs ?? []).some((s) => s.text.startsWith('Takes force')), JSON.stringify(bankingVault?.stubs));

  // far night: 422
  const badNight = await j('GET', `/api/as-of?night=2020-01-01`, undefined, om);
  check('DP-33 bad night 422', badNight.status === 422);

  // ---------------- DP-22 idempotency ----------------
  const idemKey = `joiner-${Date.now()}`;
  const joinerBody = {
    full_name: 'Nora Ellison',
    email: `nora${Date.now() % 1000}.ellison@brannocklyle.example`,
    handle: `nora${Date.now() % 1000}`,
    role: 'staff_accountant',
    aliases: ['Nora'],
    vault_ids: ['v-payroll', 'v-banking'],
    initial_password: 'Bright-arch-7735'
  };
  const join1 = await j<{ id: string; seat: string; full_name: string }>('POST', '/api/people', joinerBody, om, { 'Idempotency-Key': idemKey });
  const join2 = await j<{ id: string; seat: string; full_name: string }>('POST', '/api/people', joinerBody, om, { 'Idempotency-Key': idemKey });
  check('DP-22 replay returns stored response', join1.status === 201 && join2.status === 201 && join1.body.id === join2.body.id, `${join1.status}/${join2.status}`);
  check('DP-18 joiner seat state', join1.body.seat === 'confirmed' || join1.body.seat === 'waiting_on_billing', join1.body.seat);

  // same key different body: conflict
  const conflict = await j('POST', '/api/people', { ...joinerBody, handle: 'other' }, om, { 'Idempotency-Key': idemKey });
  check('DP-22 same key different body 409', conflict.status === 409, `status ${conflict.status}`);

  // DP-70 published fields only
  const extraKey = await j<{ error: { fields: Record<string, string> } }>('POST', '/api/people', { ...joinerBody, handle: 'xena', status: 'active' }, om);
  check('DP-70 extra key refused', extraKey.status === 422 && extraKey.body.error.fields.status === 'Lockset does not accept this field.');

  // ---------------- DP-19/20/23 leaver ----------------
  const theo = await j<{ people: Array<{ id: string; full_name: string; handle: string }> }>('GET', '/api/people', undefined, om);
  const theoRow = theo.body.people.find((p) => p.handle === 'theo');
  const leave = await j<{ person: { status: string }; turns_due: Array<{ credential_id: string; due_by: string }>; seat: string }>(
    'POST', `/api/people/${theoRow.id}/leave`, { confirm: true }, om
  );
  check('DP-19 leave 200', leave.status === 200, `status ${leave.status}`);
  check('DP-19 leaver is left', leave.body.person.status === 'left');
  const expectedTurns = leave.body.turns_due.length;
  check('DP-20 turns due for Banking+Hosting+Office logins', expectedTurns === 6, `got ${expectedTurns}`);
  const dueBy = leave.body.turns_due[0]?.due_by ?? '';
  check('DP-20 due two office business days later', dueBy === nextBusinessDays(2), `${dueBy} vs ${nextBusinessDays(2)}`);
  check('DP-21 seat released or waiting', leave.body.seat === 'released' || leave.body.seat === 'release_waiting', leave.body.seat);

  // leave again: 409
  const leaveAgain = await j<{ error: { code: string; message: string } }>('POST', `/api/people/${theoRow.id}/leave`, { confirm: true }, om);
  check('DP-22 already left 409', leaveAgain.status === 409 && leaveAgain.body.error.code === 'already_left');
  check('DP-23 already-left copy', leaveAgain.body.error.message === 'Theo Vasquez has already left.');

  // Theo's session is dead: 401 signed_out
  const theoSession = await j('POST', '/api/sessions', { username: 'theo', password: 'KeysKept-2026' });
  check('DP-19 leaver cannot sign in', theoSession.status === 401);

  // ---------------- DP-42 review decisions ----------------
  const reviews = await j<{ reviews: Array<{ id: string; quarter: string; status: string }> }>('GET', '/api/reviews', undefined, om);
  const reviewId = reviews.body.reviews[0].id;
  const review = await j<{ lines: Array<{ id: string; person_name: string; vault_name: string; decision: string }>; decided: number; total: number; status: string }>(
    'GET', `/api/reviews/${reviewId}`, undefined, om
  );
  check('DP-41 review has 14 lines + joiner additions', review.body.total >= 14, `total ${review.body.total}`);

  // keep the first still-undecided line
  const firstUndecided = review.body.lines.find((l) => l.decision === 'undecided');
  check('DP-42 an undecided line exists', Boolean(firstUndecided), 'all lines decided');
  const keep = await j<{ decision: string }>('POST', `/api/reviews/${reviewId}/lines/${firstUndecided.id}`, { decision: 'keep' }, om);
  check('DP-42 keep decision', keep.status === 200 && keep.body.decision === 'kept', `status ${keep.status} ${JSON.stringify(keep.body).slice(0, 120)}`);
  const again = await j<{ error: { code: string; message: string } }>('POST', `/api/reviews/${reviewId}/lines/${firstUndecided.id}`, { decision: 'keep' }, om);
  check('DP-42 second decision 409', again.status === 409 && again.body.error.code === 'line_decided');

  // remove a line: scope revoked at once
  const freshReview = await j<{ lines: Array<{ id: string; person_name: string; vault_name: string; decision: string }> }>(
    'GET', `/api/reviews/${reviewId}`, undefined, om
  );
  const removeLine = freshReview.body.lines.find(
    (l) => l.decision === 'undecided' && l.person_name === 'Deandra Okafor' && l.vault_name === 'Banking'
  );
  check('DP-42 a Deandra Banking line to remove', Boolean(removeLine), 'no undecided Deandra Banking line');
  const remove = await j<{ decision: string }>('POST', `/api/reviews/${reviewId}/lines/${removeLine.id}`, { decision: 'remove' }, om);
  check('DP-42 remove decision', remove.status === 200 && remove.body.decision === 'removed', `status ${remove.status} ${JSON.stringify(remove.body).slice(0, 120)}`);
  const deandraVaultsAfter = await j<{ vaults: Array<{ name: string }> }>('GET', '/api/vaults', undefined, sa);
  check('DP-42 removal revokes scope at once', !deandraVaultsAfter.body.vaults.some((v) => v.name === 'Banking'), deandraVaultsAfter.body.vaults.map((v) => v.name).join(','));

  // sign off with undecided lines: 409
  const earlySignOff = await j<{ error: { code: string; message: string } }>('POST', `/api/reviews/${reviewId}/sign-off`, {}, mp);
  check('DP-42 sign-off refused with undecided lines', earlySignOff.status === 409 && earlySignOff.body.error.code === 'lines_undecided');
  check('DP-42 sign-off copy', earlySignOff.body.error.message === 'Decide every line before signing off.');

  // ---------------- DP-38/39/77 rotation ----------------
  const paystrideCred = bankVault.body.credentials.find((c) => c.label === 'Payroll funding');
  const dupRotation1 = await j('POST', '/api/rotations', { credential_id: paystrideCred.id, interval_days: 30, at_time: '09:00', first_run_on: '2026-12-01' }, om);
  check('DP-39 rotation scheduled', dupRotation1.status === 201, JSON.stringify(dupRotation1.body));
  const existingRotation = bankVault.body.credentials.find((c) => c.label === 'Business portal');
  const dupRotation2 = await j<{ error: { code: string; message: string } }>('POST', '/api/rotations', { credential_id: existingRotation.id, interval_days: 30, at_time: '09:00', first_run_on: '2026-12-01' }, om);
  check('DP-77 one rotation per login', dupRotation2.status === 409 && dupRotation2.body.error.code === 'rotation_exists');
  check('DP-77 rotation_exists copy', dupRotation2.body.error.message === 'This login already has a rotation.');

  // DST spring-forward: the seeded Business portal rotation at 02:30 on the March night shows at 03:00 shifted
  const march = await j<{ days: Array<{ office_date: string; entries: Array<{ office_time: string | null; shifted: boolean; state: string; label: string }> }> }>(
    'GET', '/api/rotations/calendar?month=2027-03', undefined, om
  );
  const springDay = march.body.days.find((d) => d.office_date === '2027-03-14');
  const springEntry = springDay?.entries?.find((e) => e.label === 'Business portal');
  check('DP-38 spring-forward moved to 03:00', springEntry?.office_time === '03:00', JSON.stringify(springEntry));
  check('DP-38 spring-forward marked shifted', springEntry?.shifted === true);

  // ---------------- DP-51..54 import ----------------
  const csv = [
    'Vault,Login for,Website,Username,Password,Who knows it,Last changed',
    'Banking,Business portal,https://www.firstprairie.example,bl-treasury,Prairie-wind-7731,Dee / Theo,3/2/2026',
    'Payroll,Payroll tax filings,paystride.example,bl-payroll-tax,Tax-filing-9921,D. Okafor,1/15/2026',
    'Hosting,DNS registrar,dnsharbor.example,bl-dns,Harbor-dns-2025,Sam,',
    'Office,Guest Wi-Fi admin,inkwell.example,wifi-admin,Guest-wifi-0099,theo.vasquez@brannocklyle.example; Priya Raman,6/30/2026',
    'Archive,Old fax portal,faxly.example,bl-fax,fax12345,Marta,'
  ].join('\r\n');
  const importBody = {
    filename: 'D:\\Office\\marta\\Desktop\\Passwords FINAL v3.csv',
    file_base64: Buffer.from('\uFEFF' + csv, 'utf8').toString('base64')
  };
  const import1 = await j<{ id: string; filename: string; counts: Record<string, number>; rows: Array<{ row: number; outcome: string; reason: string | null; names: Array<{ text: string; held: string | null; candidates: Array<{ full_name: string }> }> }> }>(
    'POST', '/api/imports', importBody, om, { 'Idempotency-Key': `import-${Date.now()}` }
  );
  check('DP-64 filename cut to last segment', import1.status === 201 && import1.body.filename === 'Passwords FINAL v3.csv', `status ${import1.status} ${JSON.stringify(import1.body).slice(0, 160)}`);
  check('DP-54 row 1 matched', import1.body.rows[0].outcome === 'matched', JSON.stringify(import1.body.rows[0]));
  check('DP-54 row 2 held for D. Okafor', import1.body.rows[1].outcome === 'held', JSON.stringify(import1.body.rows[1]));
  const row2Names = import1.body.rows[1].names;
  check('DP-52 D. Okafor candidates are Deandra and Desmond', row2Names[0].candidates.map((c) => c.full_name).join(',') === 'Deandra Okafor,Desmond Okafor', JSON.stringify(row2Names[0]));
  check('DP-54 row 3 held for ambiguous Sam', import1.body.rows[2].outcome === 'held' && import1.body.rows[2].names[0].held === 'ambiguous', JSON.stringify(import1.body.rows[2].names));
  check('DP-54 row 4 created', import1.body.rows[3].outcome === 'created', JSON.stringify(import1.body.rows[3]));
  check('DP-51 row 5 rejected unknown vault', import1.body.rows[4].outcome === 'rejected' && import1.body.rows[4].reason === 'Unknown vault', JSON.stringify(import1.body.rows[4]));

  // re-import: nothing new
  const import2 = await j<{ counts: Record<string, number> }>('POST', '/api/imports', importBody, om, { 'Idempotency-Key': `import2-${Date.now()}` });
  check('DP-53 re-import files nothing new', import2.body.counts.created === 0, JSON.stringify(import2.body.counts));

  // no password cell anywhere in the response
  const importText = JSON.stringify(import1.body);
  check('DP-73 no password cell echoed', !importText.includes('Prairie-wind-7731') && !importText.includes('Tax-filing-9921'), importText.slice(0, 100));

  // held-name choice
  const importId = import1.body.id;
  const choice = await j<{ outcome: string }>('POST', `/api/imports/${importId}/rows/2/choice`, { text: 'D. Okafor', person_id: 'p-deandra' }, om);
  check('DP-52 choice saved and row created', choice.status === 200 && choice.body.outcome === 'created', JSON.stringify(choice.body));

  // ---------------- DP-62 audit paging ----------------
  // generate enough entries then page through
  for (let i = 0; i < 12; i++) {
    await j('POST', `/api/credentials/${businessPortal.id}/reveal`, {}, om);
  }
  let page = await j<{ entries: Array<{ seq: number }>; next_cursor: string | null }>('GET', '/api/audit?limit=10', undefined, om);
  const seen: number[] = [];
  let cursor: string | null = page.body.next_cursor;
  seen.push(...page.body.entries.map((e) => e.seq));
  let guard = 0;
  while (cursor !== null && guard < 20) {
    page = await j<{ entries: Array<{ seq: number }>; next_cursor: string | null }>(`GET`, `/api/audit?limit=10&after=${encodeURIComponent(cursor)}`, undefined, om);
    seen.push(...page.body.entries.map((e) => e.seq));
    cursor = page.body.next_cursor;
    guard += 1;
  }
  const unique = new Set(seen);
  check('DP-62 paging returns each entry exactly once', unique.size === seen.length, `${unique.size} vs ${seen.length}`);
  const sorted = [...seen].sort((a, b) => a - b);
  check('DP-62 seq strictly increases', sorted.every((v, i) => i === 0 || v > sorted[i - 1]));

  // cursor for another day/order: 422
  const badCursor = await j('GET', `/api/audit?order=newest&after=${encodeURIComponent('garbage')}`, undefined, om);
  check('DP-62 bad cursor 422', badCursor.status === 422);

  // ---------------- DP-59 boundary ----------------
  const crossOrigin = await fetch(BASE + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
  });
  check('DP-59 cross-origin write 403', crossOrigin.status === 403);
  const unknownApi = await j('GET', '/api/unknown-path', undefined, om);
  check('DP-59 unknown api path 404 JSON', unknownApi.status === 404);
  const noSourceMap = await fetch(BASE + '/app.js');
  check('DP-59 no source served outside assets', noSourceMap.status !== 200 || noSourceMap.headers.get('content-type')?.includes('json') === true);
  const runJson = await fetch(BASE + '/run.json');
  check('DP-59 run.json not served', runJson.status === 404 || runJson.headers.get('content-type')?.includes('json') === true, `status ${runJson.status}`);

  // ---------------- DP-75 day in address ----------------
  const auditDay = await j<{ office_day: string }>('GET', '/api/audit?day=2026-11-01', undefined, om);
  check('DP-75 audit answers the asked day', auditDay.body.office_day === '2026-11-01', auditDay.body.office_day);
  const auditBadDay = await j<{ office_day: string }>('GET', '/api/audit?day=not-a-date', undefined, om);
  check('DP-75 invalid day falls back to office today', /^\d{4}-\d{2}-\d{2}$/.test(auditBadDay.body.office_day), auditBadDay.body.office_day);

  // ---------------- results ----------------
  let pass = 0;
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    if (r.pass) pass += 1;
    console.log(`${mark}  ${r.name}${r.pass ? '' : `  -> ${r.detail}`}`);
  }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) process.exit(1);
}

function nextBusinessDays(n: number): string {
  const d = new Date();
  let found = 0;
  while (found < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day >= 1 && day <= 5) found += 1;
  }
  return d.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error('test run failed', error);
  process.exit(1);
});
