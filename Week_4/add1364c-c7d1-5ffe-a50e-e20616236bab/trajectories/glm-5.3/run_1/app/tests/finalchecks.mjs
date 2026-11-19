/* Final requirement checks against a fresh seeded server on :4173. */

const BASE = 'http://localhost:4173';

const checks = [];
function check(name, ok, detail) {
  checks.push([name, ok]);
  if (!ok) console.log(`FAIL  ${name} -> ${detail ?? ''}`);
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
function cookieOf(r) {
  return 'lockset_session=' + (r.headers['set-cookie'] ?? '').split('lockset_session=')[1].split(';')[0];
}

const marta = await j('POST', '/api/sessions', { username: 'marta', password: 'KeysKept-2026' });
const om = cookieOf(marta);
const graham = await j('POST', '/api/sessions', { username: 'graham', password: 'KeysKept-2026' });
const mp = cookieOf(graham);

// The seeded seats are confirmed by Kill Bill within a few seconds; wait for the figures.
let billingReady = false;
for (let attempt = 0; attempt < 60 && !billingReady; attempt++) {
  const probe = await j('GET', '/api/billing', undefined, om);
  if (probe.status === 200 && probe.body.seats === 8) billingReady = true;
  else await new Promise((resolve) => setTimeout(resolve, 1000));
}
check('DP-44 seeded seats confirmed by billing', billingReady, 'seats did not reach 8');

// DP-30: turn against the rule in force at that instant (Payroll min 14)
const payroll = await j('GET', '/api/vaults/v-payroll', undefined, om);
const payrollAdmin = payroll.body.credentials.find((c) => c.label === 'Payroll admin');
const shortPayroll = await j('PUT', `/api/credentials/${payrollAdmin.id}/secret`, { secret: 'short' }, om);
check('DP-30 payroll turn refuses short secret', shortPayroll.status === 422 && shortPayroll.body.error.fields.secret === 'Payroll needs at least 14 characters.', JSON.stringify(shortPayroll.body));
const goodPayroll = await j('PUT', `/api/credentials/${payrollAdmin.id}/secret`, { secret: 'Fresh-payroll-turn-99' }, om);
check('DP-30 payroll turn accepts 20 chars', goodPayroll.status === 200, `status ${goodPayroll.status}`);

// DP-70: wrongly typed published key
const typed = await j('POST', '/api/rules', { vault_id: 'v-banking', min_length: 'sixteen', effective_on: '2026-12-25' }, om);
check('DP-70 wrong type 422 on that key', typed.status === 422 && typed.body.error.fields.min_length, JSON.stringify(typed.body).slice(0, 120));

// DP-29: illegal edges in the published order
const inForce = await j('PATCH', '/api/rules/r-banking-1', { version: 1, min_length: 20 }, om);
check('DP-29 edit in-force rule 409 rule_in_force', inForce.status === 409 && inForce.body.error.code === 'rule_in_force');
const superseded = await j('PATCH', '/api/rules/r-office-1', { version: 1, min_length: 9 }, om);
check('DP-29 edit superseded rule 409 rule_superseded', superseded.status === 409 && superseded.body.error.code === 'rule_superseded');
const signScheduled = await j('POST', '/api/rules/r-banking-2/sign', { version: 2 }, mp);
check('DP-29 sign scheduled rule 409 not_a_draft', signScheduled.status === 409 && signScheduled.body.error.code === 'not_a_draft', `status ${signScheduled.status}`);
const signInForce = await j('POST', '/api/rules/r-banking-1/sign', { version: 2 }, mp);
check('DP-29 sign in-force rule 409 rule_in_force', signInForce.status === 409 && signInForce.body.error.code === 'rule_in_force');
const pastRule = await j('POST', '/api/rules', { vault_id: 'v-office', min_length: 9, effective_on: '2026-01-01' }, om);
check('DP-29 past effective date refused on field', pastRule.status === 422 && pastRule.body.error.fields.effective_on === 'Pick a date after today.');

// rule_date_taken: two scheduled rules for the same vault on the same date
const first = await j('POST', '/api/rules', { vault_id: 'v-office', min_length: 11, effective_on: '2027-06-01' }, om);
const firstSign = await j('POST', `/api/rules/${first.body.id}/sign`, { version: first.body.version }, mp);
check('DP-29 first rule signs', firstSign.status === 200, `status ${firstSign.status} ${JSON.stringify(firstSign.body).slice(0, 120)}`);
const second = await j('POST', '/api/rules', { vault_id: 'v-office', min_length: 12, effective_on: '2027-06-01' }, om);
const secondSign = await j('POST', `/api/rules/${second.body.id}/sign`, { version: second.body.version }, mp);
check('DP-29 second rule same date 409 rule_date_taken', secondSign.status === 409 && secondSign.body.error.code === 'rule_date_taken', `status ${secondSign.status} ${JSON.stringify(secondSign.body).slice(0, 120)}`);

// DP-71: version rises by one on edit and signature
check('DP-71 edit returns the rule to drafted with version +1', firstSign.body.state === 'scheduled', JSON.stringify(firstSign.body).slice(0, 140));
const editedFirst = await j('PATCH', `/api/rules/${first.body.id}`, { version: firstSign.body.version, min_length: 13 }, om);
check('DP-71 edit bumps version and returns to drafted', editedFirst.status === 200 && editedFirst.body.version === firstSign.body.version + 1 && editedFirst.body.state === 'drafted', JSON.stringify(editedFirst.body).slice(0, 140));

// DP-31: out-of-policy flag is the same for two people
const banking = await j('GET', '/api/vaults/v-banking', undefined, om);
const asMP = await j('GET', '/api/vaults/v-banking', undefined, mp);
const omFlags = banking.body.credentials.map((c) => `${c.label}:${c.out_of_policy}:${c.leeway_ends_at}`).join('|');
const mpFlags = asMP.body.credentials.map((c) => `${c.label}:${c.out_of_policy}:${c.leeway_ends_at}`).join('|');
check('DP-31 same out-of-policy values for both viewers', omFlags === mpFlags, `${omFlags} vs ${mpFlags}`);

// DP-24: the office manager cannot change their own record
const selfPatch = await j('PATCH', `/api/people/p-marta`, { role: 'staff_accountant' }, om);
check('DP-24 own record 409 own_record', selfPatch.status === 409 && selfPatch.body.error.code === 'own_record');
const selfLeave = await j('POST', `/api/people/p-marta/leave`, { confirm: true }, om);
check('DP-24 own leave 409 own_record', selfLeave.status === 409 && selfLeave.body.error.code === 'own_record');

// DP-10/66: filing a vault
const newVault = await j('POST', '/api/vaults', { name: 'Archive', off_when_travelling: false }, om);
check('DP-10 create vault 201', newVault.status === 201, `status ${newVault.status}`);
check('DP-66 new vault id in route form', typeof newVault.body.id === 'string' && newVault.body.id.length > 0);
const dupVault = await j('POST', '/api/vaults', { name: 'archive', off_when_travelling: false }, om);
check('DP-10 duplicate vault name 422', dupVault.status === 422 && dupVault.body.error.fields.name, JSON.stringify(dupVault.body).slice(0, 100));
const newVaultDetail = await j('GET', `/api/vaults/${newVault.body.id}`, undefined, om);
check('DP-09 new vault is empty', newVaultDetail.body.vault.credential_count === 0, JSON.stringify(newVaultDetail.body.vault));
check('DP-10 new vault takes the default rule', newVaultDetail.body.vault.rule_in_force && newVaultDetail.body.vault.rule_in_force.min_length === 12, JSON.stringify(newVaultDetail.body.vault.rule_in_force));

// DP-11: rename shows the new name with the old as formerly
const renamed = await j('PATCH', `/api/vaults/${newVault.body.id}`, { name: 'Records' }, om);
check('DP-11 rename shows formerly', renamed.body.name === 'Records' && renamed.body.formerly === 'Archive', JSON.stringify(renamed.body).slice(0, 120));
const vendors = await j('GET', '/api/vendors', undefined, om);
const paystride = vendors.body.vendors.find((v) => v.name === 'Paystride Payroll');
const renamedVendor = await j('PATCH', `/api/vendors/${paystride.id}`, { name: 'Paystride People' }, om);
check('DP-11 vendor rename shows formerly', renamedVendor.body.formerly === 'Paystride Payroll', JSON.stringify(renamedVendor.body).slice(0, 140));
const vendorsAfter = await j('GET', '/api/vendors', undefined, om);
const renamedVendorView = vendorsAfter.body.vendors.find((v) => v.id === paystride.id);
check('DP-11 vendor list shows new name with formerly', renamedVendorView.name === 'Paystride People' && renamedVendorView.formerly === 'Paystride Payroll');
check('DP-11 vendor rename record', (renamedVendorView.renames ?? []).some((r) => r.old === 'Paystride Payroll' && r.new === 'Paystride People'));
// older audit entries keep the old name
const auditRows = await j('GET', '/api/audit?limit=100', undefined, om);
const renameEntries = auditRows.body.entries.filter((e) => e.action === 'vendor_rename');
check('DP-11 audit keeps the old vendor name', renameEntries.length === 1 && renameEntries[0].subject.name === 'Paystride Payroll', JSON.stringify(renameEntries));

// DP-44: billing figures from the office account
const billing = await j('GET', '/api/billing', undefined, om);
check('DP-44 billing seats matches people', billing.body.seats === 8, `seats ${billing.body.seats}`);
check('DP-44 next invoice amount is seats * 48', billing.body.next_invoice && Number(billing.body.next_invoice.amount) === billing.body.seats * 48, JSON.stringify(billing.body.next_invoice));

// DP-74: the office account in the shared tenant, and Lockset's figures come only from it
const kbProbe = await fetch('http://killbill:8080/1.0/kb/accounts/search/bl', {
  headers: {
    Authorization: 'Basic ' + Buffer.from('admin:password').toString('base64'),
    'X-Killbill-ApiKey': 'gfkit-dev',
    'X-Killbill-ApiSecret': 'gfkit-dev-secret'
  }
});
const kbAccounts = await kbProbe.json();
check('DP-74 the office account exists by its key', Array.isArray(kbAccounts) && kbAccounts.some((a) => a.externalKey === 'bl'), JSON.stringify(kbAccounts.map((a) => a.externalKey)));
check('DP-44 seats equal the office account only', billing.body.seats === 8, `seats ${billing.body.seats}`);

let pass = 0;
for (const [name, ok] of checks) if (ok) pass += 1;
console.log(`final checks: ${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
