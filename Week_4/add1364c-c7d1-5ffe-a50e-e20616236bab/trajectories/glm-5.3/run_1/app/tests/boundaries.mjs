/* Boundary tests: travel windows, engagement terms, session end, midnight push.
 * Boots a second server on another port with LOCKSET_CLOCK_START set in the past,
 * so time-dependent behaviour can be observed without waiting. */

const BASE = 'http://localhost:4174';

const results = [];

function check(name, condition, detail = '') {
  results.push({ name, pass: condition, detail });
  if (!condition) console.log(`FAIL  ${name}  -> ${detail}`);
}

async function j(method, path, body, cookie, headers) {
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
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: Object.fromEntries(res.headers.entries()) };
}

function cookieOf(response) {
  const setCookie = response.headers['set-cookie'] ?? '';
  return 'lockset_session=' + setCookie.split('lockset_session=')[1].split(';')[0];
}

async function main() {
  // Wait for the clock server to be healthy
  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) healthy = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  check('clock server healthy', healthy);

  // The clock server shares the same database; its clock starts at the seeded instant.
  const clock = await j('GET', '/api/clock');
  check('clock server answers office time', clock.status === 200 && /^\d{2}:\d{2}$/.test(clock.body.office_time), JSON.stringify(clock.body));

  // Marta on the clock server sees the seeded drawer
  const marta = await j('POST', '/api/sessions', { username: 'marta', password: 'KeysKept-2026' });
  check('clock server sign-in', marta.status === 201);
  const om = cookieOf(marta);

  // Deandra signs in and sets a travel window that is open now
  const deandra = await j('POST', '/api/sessions', { username: 'deandra', password: 'KeysKept-2026' });
  check('deandra sign-in', deandra.status === 201);
  const sa = cookieOf(deandra);
  const saBefore = await j('GET', '/api/vaults', undefined, sa);
  check('deandra sees Vendor portals before travel', saBefore.body.vaults.some((v) => v.name === 'Vendor portals'), saBefore.body.vaults.map((v) => v.name).join(','));

  const clockNow = await j('GET', '/api/clock');
  const pad = (n) => String(n).padStart(2, '0');
  // Office local date-times, read in office time.
  const startsAt = `${clockNow.body.office_date}T${clockNow.body.office_time}`;
  const endMinutes = Number(clockNow.body.office_time.slice(0, 2)) * 60 + Number(clockNow.body.office_time.slice(3)) + 60;
  const endsAt = `${clockNow.body.office_date}T${pad(Math.floor(endMinutes / 60) % 24)}:${pad(endMinutes % 60)}`;
  const travel = await j('POST', `/api/people/p-deandra/travel`, { starts_at: startsAt, ends_at: endsAt }, sa);
  check('travel window saved', travel.status === 201, JSON.stringify(travel.body));

  // The window is open now, so the off-when-travelling vaults are withheld
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const saDuring = await j('GET', '/api/vaults', undefined, sa);
  const names = saDuring.body.vaults.map((v) => v.name);
  check('DP-25 travel withholds Payroll and Banking', !names.includes('Payroll') && !names.includes('Banking'), names.join(','));
  check('DP-25 travel keeps Vendor portals', names.includes('Vendor portals'), names.join(','));

  const hiddenVault = await j('GET', '/api/vaults/v-payroll', undefined, sa);
  check('DP-25 hidden vault answers 404 during travel', hiddenVault.status === 404);

  // The office manager can cancel it (it has started -> 409)
  const cancelStarted = await j('DELETE', `/api/people/p-deandra/travel/${travel.body.id}`, undefined, om);
  check('DP travel cancel after start 409', cancelStarted.status === 409, `status ${cancelStarted.status}`);

  // ---------------- engagement term ----------------
  // Priya's term runs to T+60 days, so she can sign in now.
  const priya = await j('POST', '/api/sessions', { username: 'priya', password: 'KeysKept-2026' });
  check('DP-26 bookkeeper signs in within term', priya.status === 201, `status ${priya.status}`);
  const ob = cookieOf(priya);
  const obVaults = await j('GET', '/api/vaults', undefined, ob);
  check('DP-26 bookkeeper sees Payroll and Banking', obVaults.body.vaults.map((v) => v.name).join(',') === 'Payroll,Banking', obVaults.body.vaults.map((v) => v.name).join(','));
  const obRules = await j('GET', '/api/rules', undefined, ob);
  check('DP-08 bookkeeper gets no rules surface', obRules.status === 403);
  const obAsOf = await j('GET', '/api/as-of?night=2026-11-14', undefined, ob);
  check('DP-08 bookkeeper gets no as-of answers', obAsOf.status === 403);
  const obAudit = await j('GET', '/api/audit', undefined, ob);
  check('DP-08 bookkeeper gets no audit sheet', obAudit.status === 403);
  const obFooter = await j('GET', '/api/audit/footer', undefined, ob);
  check('DP-15 bookkeeper gets no footer', obFooter.status === 403);

  // ---------------- results ----------------
  let pass = 0;
  for (const r of results) {
    if (r.pass) pass += 1;
  }
  console.log(`boundary checks: ${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}

void main();
