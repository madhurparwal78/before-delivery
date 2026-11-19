/** End-to-end amendment and recurrence flow test. */
const base = 'http://127.0.0.1:4173';
let cookie = '';
const call = async (method, path, body, opts = {}) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET' && method !== 'DELETE') headers['Content-Type'] = 'application/json';
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body ?? {}) });
  const sc = r.headers.get('set-cookie');
  if (sc?.includes('ob_owner=')) cookie = sc.split(';')[0];
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};

await call('POST', '/api/owner/session', { passphrase: 'bonnet-up-at-dawn' });
const car = await call('POST', '/api/owner/cars', { name: 'Amend Test Car', registration: 'K204PLM', askingPounds: 9000, viewingArea: 'Near Hexham', homeAddress: '2 Test Road, Hexham NE46 9ZZ', story: 'A test car for amendments.' });
console.log('create car:', car.status);
const id = car.json.id;
await call('PUT', `/api/owner/cars/${id}/readings`, { readings: [{ panelId: 'bonnet', microns: 120 }, { panelId: 'os-door', microns: 130 }, { panelId: 'ns-door', microns: 118 }] });
const f1 = await call('POST', `/api/owner/cars/${id}/findings`, { panelId: 'bonnet', u: 0.5, v: 0.5, title: 'Chipped edge', wording: 'Chips along the front edge.', severity: 'moderate' });
console.log('finding:', f1.status);
const pull = await call('POST', `/api/owner/cars/${id}/record/pull`);
for (const a of pull.json.advisories) {
  await call('PUT', `/api/owner/cars/${id}/advisories/${encodeURIComponent(a.id)}`, { stance: 'monitoring', note: 'Watching this item.' });
}
console.log('pull 1 advisories answered:', pull.json.advisories.length);
const pub1 = await call('POST', `/api/owner/cars/${id}/publish`);
console.log('publish v1:', pub1.status, pub1.json.version ?? pub1.json.error);
const link = await call('POST', `/api/owner/cars/${id}/links`, { role: 'buyer', name: 'Amend Buyer' });
console.log('link:', link.status);
const token = link.json.path.slice(3);
const view1 = await fetch(base + `/api/link/${token}`).then(r => r.json());
await call('POST', `/api/link/${token}/seen`, { findingId: view1.findings[0].id });
const view1b = await fetch(base + `/api/link/${token}`).then(r => r.json());
console.log('buyer seen all:', view1b.progress);
// The re-pull brings a new advisory for K204PLM.
const pull2 = await call('POST', `/api/owner/cars/${id}/record/pull`);
for (const a of pull2.json.advisories) {
  if (a.stance === null) {
    await call('PUT', `/api/owner/cars/${id}/advisories/${encodeURIComponent(a.id)}`, { stance: 'monitoring', note: 'Watching this item too.' });
  }
}
console.log('after re-pull, advisories:', pull2.json.advisories.length);
// Amend the finding and publish v2.
const amend = await call('PATCH', `/api/owner/cars/${id}/findings/${f1.json.id}`, { wording: 'Chips along the front edge, now touched in.' }, { ifMatch: String(f1.json.revision) });
console.log('amend finding:', amend.status, 'revision now', amend.json.revision);
const pub2 = await call('POST', `/api/owner/cars/${id}/publish`);
console.log('publish v2:', pub2.status, pub2.json.version ?? pub2.json.error);
// The buyer's seen record is cleared for the changed finding only.
const view2 = await fetch(base + `/api/link/${token}`).then(r => r.json());
console.log('buyer after amendment:', JSON.stringify(view2.findings.map(f => ({ seen: f.seen, changed: f.changedSinceSeen }))));
console.log('versionsRead:', view2.versionsRead, 'progress:', view2.progress);
// The earlier version stays readable.
const v1 = await fetch(base + `/api/link/${token}/versions/1`).then(r => r.json());
console.log('earlier version readable:', v1.findings ? 'yes' : 'no', v1.findings?.[0]?.wording);
// Re-read: seen again on the new wording.
await call('POST', `/api/link/${token}/seen`, { findingId: view2.findings[0].id });
const view3 = await fetch(base + `/api/link/${token}`).then(r => r.json());
console.log('after re-read:', view3.progress, 'versionsRead:', view3.versionsRead);

// Recurrence check with L611RWD: repaired advisory that returns at a later test.
const car2 = await call('POST', '/api/owner/cars', { name: 'Recur Test Car', registration: 'L611RWD', askingPounds: 5000, viewingArea: 'Near Hexham', homeAddress: '2 Test Road, Hexham NE46 9ZZ', story: 'A test car for recurrence.' });
const id2 = car2.json.id;
const rp1 = await call('POST', `/api/owner/cars/${id2}/record/pull`);
console.log('L611RWD first pull advisories:', rp1.json.advisories.map(a => a.text));
const firstAdvisory = rp1.json.advisories[0];
await call('PUT', `/api/owner/cars/${id2}/advisories/${encodeURIComponent(firstAdvisory.id)}`, { stance: 'repaired', note: 'Pipe replaced.' });
const rp2 = await call('POST', `/api/owner/cars/${id2}/record/pull`);
console.log('after second pull, recurred flags:', rp2.json.advisories.map(a => ({ stance: a.stance, recurred: a.recurred })));
const repairedAgain = await call('PUT', `/api/owner/cars/${id2}/advisories/${encodeURIComponent(firstAdvisory.id)}`, { stance: 'repaired', note: 'Pipe replaced again.' });
console.log('repaired on recurred advisory refused:', repairedAgain.status, repairedAgain.json.errors?.stance);
const changedStance = await call('PUT', `/api/owner/cars/${id2}/advisories/${encodeURIComponent(firstAdvisory.id)}`, { stance: 'monitoring', note: 'Watching the repaired area.' });
console.log('stance change on recurred advisory:', changedStance.status, 'recurred now:', changedStance.json.recurred);
const car2Now = await call('GET', `/api/owner/cars/${id2}`);
console.log('recur blockers:', car2Now.json.publishBlockers, 'open:', car2Now.json.workingOpenAdvisories);
