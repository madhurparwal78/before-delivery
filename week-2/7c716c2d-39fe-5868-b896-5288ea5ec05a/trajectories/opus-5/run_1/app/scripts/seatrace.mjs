// Two invitees race for the last free seat, after the seat count is lowered
// directly in Kill Bill.
const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const killbill = process.env.KILLBILL_URL;

const kbHeaders = {
  Authorization: `Basic ${Buffer.from(`${process.env.KILLBILL_USERNAME}:${process.env.KILLBILL_PASSWORD}`).toString('base64')}`,
  'X-Killbill-ApiKey': process.env.KILLBILL_API_KEY,
  'X-Killbill-ApiSecret': process.env.KILLBILL_API_SECRET,
  'X-Killbill-CreatedBy': 'seatrace',
  'Content-Type': 'application/json',
};

async function kb(method, path, body) {
  const response = await fetch(killbill + path, {
    method,
    headers: kbHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

async function session(email, password = 'tally-demo-1') {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await response.json();
  return (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('tr_session='));
}

async function call(cookie, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

const ana = await session('ana@kereru.test');
const billing = (await call(ana, 'GET', '/api/billing')).json;
console.log('starting billing:', billing.limit, billing.active, billing.pending);
const wanted = billing.active + 2;
console.log('raise to', wanted, (await call(ana, 'PUT', '/api/billing/seats', { seats: wanted })).status);

const stamp = Date.now().toString(36);
const racers = [`race.a.${stamp}@contract.test`, `race.b.${stamp}@contract.test`];
const invites = [];
for (const email of racers) {
  const invite = await call(ana, 'POST', '/api/invites', { email, role: 'member', project_ids: [], channel_ids: [] });
  console.log('invite', email, invite.status);
  invites.push(invite.json.id);
}

const cookies = [];
for (const email of racers) {
  await fetch(`${base}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Racer', email, password: 'racer-pass-1' }),
  });
  cookies.push(await session(email, 'racer-pass-1'));
}

// Lower the seat count directly in Kill Bill so only one seat is free.
const account = (await kb('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(billing.account_external_key)}`)).json;
const bundles = (await kb('GET', `/1.0/kb/accounts/${account.accountId}/bundles`)).json;
const subscription = bundles.flatMap((bundle) => bundle.subscriptions).find((entry) => entry.planName === 'tallyroom-seat-monthly');
const fields = (await kb('GET', `/1.0/kb/subscriptions/${subscription.subscriptionId}/customFields`)).json;
const seatsField = fields.find((field) => field.name === 'seats');
const lowered = billing.active + 1;
console.log(
  'lowering seats in Kill Bill to',
  lowered,
  (await kb('PUT', `/1.0/kb/subscriptions/${subscription.subscriptionId}/customFields`, [
    { customFieldId: seatsField.customFieldId, name: 'seats', value: String(lowered) },
  ])).status,
);
await new Promise((resolve) => setTimeout(resolve, 11000));
const adopted = (await call(ana, 'GET', '/api/billing')).json;
console.log('limit adopted from Kill Bill:', adopted.limit, 'active:', adopted.active);

const results = await Promise.all(
  invites.map((id, index) => call(cookies[index], 'POST', `/api/invites/${id}/accept`, {})),
);
console.log('accept statuses:', results.map((result) => result.status));
console.log('accept codes:', results.map((result) => result.json?.error?.code ?? 'joined'));
const after = (await call(ana, 'GET', '/api/billing')).json;
console.log('active after the race:', after.active, 'limit:', after.limit);
console.log('exactly one joined:', results.filter((result) => result.status === 200).length === 1);
console.log('active never above the limit:', after.active <= after.limit);
