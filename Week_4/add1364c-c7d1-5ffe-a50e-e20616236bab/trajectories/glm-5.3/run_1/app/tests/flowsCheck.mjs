/* Remaining flow checks: copy, lockout parity, fall-back run once, vendor rename surface. */
const BASE = 'http://localhost:4173';
const checks = [];
function check(name, ok, detail) { checks.push([name, ok]); if (!ok) console.log(`FAIL  ${name} -> ${detail ?? ''}`); }

async function j(method, path, body, cookie, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: Object.fromEntries(res.headers.entries()) };
}
function cookieOf(r) { return 'lockset_session=' + (r.headers['set-cookie'] ?? '').split('lockset_session=')[1].split(';')[0]; }

const marta = await j('POST', '/api/sessions', { username: 'marta', password: 'KeysKept-2026' });
const om = cookieOf(marta);

// DP-04: copy returns the secret with the rule in force recorded
const hosting = await j('GET', '/api/vaults/v-hosting', undefined, om);
const websiteHost = hosting.body.credentials.find(c => c.label === 'Website host');
const copy = await j('POST', `/api/credentials/${websiteHost.id}/copy`, {}, om);
check('DP-04 copy returns the secret', copy.status === 200 && copy.body.secret === 'Gh-stack-plum-8812', JSON.stringify(copy.body).slice(0, 80));
check('DP-04 copy records the rule', copy.body.rule_id === 'r-hosting', JSON.stringify(copy.body).slice(0, 80));

// copy on the leeway-expired login: 423
const office = await j('GET', '/api/vaults/v-office', undefined, om);
const printer = office.body.credentials.find(c => c.label === 'Front desk printer admin');
const printerCopy = await j('POST', `/api/credentials/${printer.id}/copy`, {}, om);
check('DP-05 copy past leeway 423', printerCopy.status === 423 && printerCopy.body.error.code === 'turn_required');

// DP-69: five failures for a handle not on record lock identically to one on record
const unknown = `ghost${Date.now() % 100000}`;
for (let i = 0; i < 5; i++) {
  await j('POST', '/api/sessions', { username: unknown, password: 'nope' });
}
const unknownLocked = await j('POST', '/api/sessions', { username: unknown, password: 'nope' });
check('DP-69 unknown handle locks 429', unknownLocked.status === 429, `status ${unknownLocked.status}`);
const known = `sam${Date.now() % 1000}x`;
for (let i = 0; i < 5; i++) {
  await j('POST', '/api/sessions', { username: 'desmond', password: 'nope' });
}
const knownLocked = await j('POST', '/api/sessions', { username: 'desmond', password: 'nope' });
check('DP-69 known handle locks 429', knownLocked.status === 429, `status ${knownLocked.status}`);
// identical shape: same code and message prefix
check('DP-69 lockout answers identical', unknownLocked.body.error.code === knownLocked.body.error.code && unknownLocked.body.error.message.startsWith(knownLocked.body.error.message.slice(0, 30)));

// a successful sign-in before the lock resets the count: marta signs in fine
const martaOk = await j('POST', '/api/sessions', { username: 'marta', password: 'KeysKept-2026' });
check('DP-69 other handles unaffected', martaOk.status === 201);

// DP-38: the fall-back run appears once on the calendar at 01:30 (first occurrence)
const november = await j('GET', '/api/rotations/calendar?month=2027-11', undefined, om);
const fallDay = november.body.days.find(d => d.office_date === '2027-11-07');
const websiteEntries = (fallDay?.entries ?? []).filter(e => e.label === 'Website host');
check('DP-38 fall-back run shows once', websiteEntries.length === 1, JSON.stringify(websiteEntries));
check('DP-38 fall-back run at 01:30', websiteEntries[0]?.office_time === '01:30', JSON.stringify(websiteEntries[0]?.office_time));
check('DP-38 fall-back run not shifted', websiteEntries[0]?.shifted === false);

// DP-40: the calendar's day labels carry the offset in effect at midnight
check('DP-40 day labels carry the offset', november.body.days.every(d => d.offset === 'CST' || d.offset === 'CDT'), JSON.stringify(november.body.days[0]));

// DP-12: rename a vendor and see the new name on slips, the rotation calendar and review lines
const vendors = await j('GET', '/api/vendors', undefined, om);
const tallyroom = vendors.body.vendors.find(v => v.name === 'Tallyroom Practice Suite');
await j('PATCH', `/api/vendors/${tallyroom.id}`, { name: 'Tallyroom Suite' }, om);
const vendorsAfter = await j('GET', '/api/vendors', undefined, om);
const renamed = vendorsAfter.body.vendors.find(v => v.id === tallyroom.id);
check('DP-12 vendor shows new name with formerly', renamed.name === 'Tallyroom Suite' && renamed.formerly === 'Tallyroom Practice Suite');
const vendorsVault = await j('GET', '/api/vaults/v-vendors', undefined, om);
const practiceAdmin = vendorsVault.body.credentials.find(c => c.label === 'Practice admin');
check('DP-12 slip shows the new vendor name', practiceAdmin.vendor.name === 'Tallyroom Suite' && practiceAdmin.vendor.formerly === 'Tallyroom Practice Suite', JSON.stringify(practiceAdmin.vendor));
const reviews = await j('GET', '/api/reviews', undefined, om);
const review = await j('GET', `/api/reviews/${reviews.body.reviews[0].id}`, undefined, om);
const vendorsOnLines = review.body.lines.flatMap(l => l.vendors.map(v => v.name));
check('DP-12 review lines show the new vendor name', vendorsOnLines.includes('Tallyroom Suite'), vendorsOnLines.join(','));

let pass = 0;
for (const [name, ok] of checks) if (ok) pass += 1;
console.log(`flow checks: ${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
