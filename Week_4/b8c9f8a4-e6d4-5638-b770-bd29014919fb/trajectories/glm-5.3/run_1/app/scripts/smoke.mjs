#!/usr/bin/env node
/** End-to-end API smoke test against a running server. */
const base = 'http://127.0.0.1:4173';
let cookie = '';
let pass = 0;
let fail = 0;

function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`); }
}

async function call(method, path, body, opts = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') headers['Content-Type'] = 'application/json';
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  const reply = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body ?? {})),
  });
  const setCookie = reply.headers.get('set-cookie');
  if (setCookie?.includes('ob_owner=')) cookie = setCookie.split(';')[0];
  const text = await reply.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: reply.status, json, text, headers: Object.fromEntries(reply.headers) };
}

async function main() {
  // ---- reset state so the run is repeatable (a running serve instance re-seeds)
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', ['scripts/reset-db.mjs'], { cwd: process.cwd(), env: process.env });
  console.log('db reset; waiting for serve to reseed');
  for (let attempt = 0; attempt < 90; attempt++) {
    const probe = await call('GET', '/api/health');
    if (probe.status === 200) {
      const carsProbe = await call('GET', '/api/owner/cars/sessionless-probe');
      void carsProbe;
      const session = await call('POST', '/api/owner/session', { passphrase: 'bonnet-up-at-dawn' });
      if (session.status === 200) { cookie = ''; break; }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // ---- health
  const health = await call('GET', '/api/health');
  check('health ok', health.status === 200 && health.json.status === 'ok');

  // ---- sign in
  const bad = await call('POST', '/api/owner/session', { passphrase: 'wrong' });
  check('bad passphrase refused', bad.status === 401 && bad.json.error === 'bad_passphrase');
  const signIn = await call('POST', '/api/owner/session', { passphrase: 'bonnet-up-at-dawn' });
  check('sign in', signIn.status === 200 && signIn.json.signedIn === true);

  // ---- cars list
  const cars = await call('GET', '/api/owner/cars');
  check('two seeded cars', cars.json.cars.length === 2, `got ${cars.json.cars.length}`);
  const car1 = cars.json.cars.find((c) => c.registration === 'S482KVT');
  const car2 = cars.json.cars.find((c) => c.registration === 'T317HJN');
  check('car1 live v1', car1.listingStatus === 'live' && car1.currentVersion === 1);
  check('car1 standings', car1.standing.panelsRead === 11 && car1.standing.findings === 9 && car1.standing.activeLinks === 4 && car1.standing.slotsHeld === 1 && car1.standing.liveOffers === 1, JSON.stringify(car1.standing));
  check('car2 draft with blockers', car2.listingStatus === 'draft' && car2.publishBlockers.includes('no_findings') && car2.publishBlockers.includes('no_record_pull'));

  // ---- panels and bands
  const panels = await call('GET', `/api/owner/cars/${car1.id}/panels`);
  check('panels thirteen', panels.json.panels.length === 13);
  const sill = panels.json.panels.find((p) => p.id === 'os-sill');
  const wing = panels.json.panels.find((p) => p.id === 'os-front-wing');
  const bumper = panels.json.panels.find((p) => p.id === 'rear-bumper');
  check('steel median 121', panels.json.medians.steel === 121, `got ${panels.json.medians.steel}`);
  check('aluminium median 100', panels.json.medians.aluminium === 100, `got ${panels.json.medians.aluminium}`);
  check('sill Filler', sill.owner.band === 'Filler');
  check('wing Refinished', wing.owner.band === 'Refinished');
  check('mils conversion', sill.owner.mils === '16.9', sill.owner.mils);
  check('plastic Not gauged', bumper.owner === null);

  // ---- readings validation
  const badReading = await call('PUT', `/api/owner/cars/${car1.id}/readings`, { readings: [{ panelId: 'rear-bumper', microns: 100 }] });
  check('plastic reading refused', badReading.status === 422 && badReading.json.errors['rear-bumper'] === 'Plastic panels cannot be gauged');
  const badRange = await call('PUT', `/api/owner/cars/${car1.id}/readings`, { readings: [{ panelId: 'roof', microns: 0 }] });
  check('microns range refused', badRange.status === 422 && badRange.json.errors.roof === 'Enter whole microns from 1 to 2000');

  // ---- findings with stale refusal
  const findings = await call('GET', `/api/owner/cars/${car1.id}/findings`);
  check('nine findings', findings.json.findings.length === 9);
  const hero = findings.json.findings.find((f) => f.title === 'Sill filler');
  check('finding revision 1', hero.revision === 1);
  const stale = await call('PATCH', `/api/owner/cars/${car1.id}/findings/${hero.id}`, { title: 'Changed' }, { ifMatch: '"0"' });
  check('stale edit refused', stale.status === 412 && stale.json.error === 'stale_finding' && stale.json.currentRevision === 1);
  const noMatch = await call('DELETE', `/api/owner/cars/${car1.id}/findings/${hero.id}`);
  check('If-Match required', noMatch.status === 428);

  // ---- record pull
  const pull = await call('POST', `/api/owner/cars/${car1.id}/record/pull`);
  check('record pull ok', pull.status === 201 && pull.json.tape.length === 7, JSON.stringify(pull.json).slice(0,200));
  const tape2024 = pull.json.tape.find((t) => t.motTestNumber === '730000000410');
  check('km test flagged unit change not drop', tape2024.flag === 'unit_change', tape2024.flag);
  const tape2023 = pull.json.tape.find((t) => t.motTestNumber === '730000000309');
  check('no odometer skipped', tape2023.status === 'skipped' && tape2023.flag === 'no_odometer');
  const adv = pull.json.advisories.find((a) => a.text === 'Offside sill corroded but not seriously weakened');
  check('monitoring advisory open', adv.stance === 'monitoring' && adv.recurred === false);
  check('open advisories 1', pull.json.openAdvisories === 1, `got ${pull.json.openAdvisories}`);

  // ---- record failure states
  const newCar = await call('POST', '/api/owner/cars', { name: 'Test Fail', registration: 'zz99nof', askingPounds: 1000, viewingArea: 'Near Hexham', homeAddress: '1 Test Road, Hexham NE46 9ZZ', story: 'A test car.' });
  check('car created', newCar.status === 201);
  const nf = await call('POST', `/api/owner/cars/${newCar.json.id}/record/pull`);
  check('record not found', nf.status === 404 && nf.json.error === 'record_not_found');

  // ---- throttled
  const newCar2 = await call('POST', '/api/owner/cars', { name: 'Test Throttle', registration: 'zz99thr', askingPounds: 1000, viewingArea: 'Near Hexham', homeAddress: '1 Test Road, Hexham NE46 9ZZ', story: 'A test car.' });
  const thr = await call('POST', `/api/owner/cars/${newCar2.json.id}/record/pull`);
  check('throttled', thr.status === 429 && thr.json.error === 'record_throttled' && thr.json.retryAfterSeconds === 30);

  // ---- publish gate
  const pubBlock = await call('POST', `/api/owner/cars/${newCar2.json.id}/publish`);
  check('publish blocked reasons', pubBlock.status === 409 && pubBlock.json.reasons.includes('no_findings') && pubBlock.json.reasons.includes('no_record_pull'));

  // ---- link issues
  const linkBlocked = await call('POST', `/api/owner/cars/${newCar2.json.id}/links`, { role: 'buyer', name: 'Nobody' });
  check('links need live listing', linkBlocked.status === 409 && linkBlocked.json.error === 'listing_not_published');

  // ---- car1 links table
  const links = await call('GET', `/api/owner/cars/${car1.id}/links`);
  check('four links', links.json.links.length === 4);
  const rowan = links.json.links.find((l) => l.name === 'Rowan Hale');
  const imogen = links.json.links.find((l) => l.name === 'Imogen Achebe');
  const tam = links.json.links.find((l) => l.name === 'Tam Okafor');
  check('rowan 0 of 9', rowan.seen === 0 && rowan.total === 9);
  check('imogen 9 of 9 with offer', imogen.seen === 9 && imogen.offerStatus === 'open');
  check('inspector zero totals', tam.seen === 0 && tam.total === 0);

  // ---- offers table
  const offers = await call('GET', `/api/owner/cars/${car1.id}/offers`);
  check('one open offer', offers.json.offers.length === 1 && offers.json.offers[0].status === 'open' && offers.json.offers[0].amountPounds === 15400);

  // ---- buyer seen and offer flow
  const rowanView = await fetch(base + '/api/link/seed-buyer-rowan-7f3c9a1e').then(r => r.json());
  const firstFinding = rowanView.findings[0];
  const seen1 = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/seen', { findingId: firstFinding.id });
  check('first seen 201', seen1.status === 201 && seen1.json.progress.seen === 1);
  const seen2 = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/seen', { findingId: firstFinding.id });
  check('repeat seen 200 with original date', seen2.status === 200 && seen2.json.seenAt === seen1.json.seenAt);

  // offer gate: material findings unseen
  const offerBlocked = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 10000 }, { key: 'rowan-offer-1' });
  check('offer blocked material unseen', offerBlocked.status === 409 && offerBlocked.json.error === 'material_findings_unseen' && offerBlocked.json.unseen.length === 4, JSON.stringify(offerBlocked.json).slice(0,200));

  // see every material finding, then offer
  for (const f of rowanView.findings) {
    if (f.material) await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/seen', { findingId: f.id });
  }
  const offer = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 12000 }, { key: 'rowan-offer-2' });
  check('rowan offer created', offer.status === 201 && offer.json.amountPounds === 12000, JSON.stringify(offer.json).slice(0,200));
  const offerReplay = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 12000 }, { key: 'rowan-offer-2' });
  check('offer replay same response', offerReplay.status === 201 && offerReplay.json.id === offer.json.id);
  const offerConflict = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 9999 }, { key: 'rowan-offer-2' });
  check('idempotency conflict on different body', offerConflict.status === 409 && offerConflict.json.error === 'idempotency_conflict');
  const offerDup = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 11000 }, { key: 'rowan-offer-3' });
  check('second live offer refused', offerDup.status === 409 && offerDup.json.error === 'offer_exists');
  const noKey = await call('POST', '/api/link/seed-buyer-rowan-7f3c9a1e/offers', { amountPounds: 9000 });
  check('missing idempotency key 422', noKey.status === 422 && noKey.json.errors['Idempotency-Key'] !== undefined);

  // ---- alerts (claim + offer raised two)
  const alerts = await call('GET', '/api/owner/alerts');
  check('alerts recorded', alerts.json.alerts.length >= 1, `got ${alerts.json.alerts.length}`);

  // ---- slots: claim conflicts
  const slots = await call('GET', `/api/owner/cars/${car1.id}/slots`);
  const freeSlot = slots.json.slots.find((s) => s.held === false);
  const rowanSlot = freeSlot.id;
  const claim = await call('POST', `/api/link/seed-buyer-rowan-7f3c9a1e/slots/${rowanSlot}/claim`, {}, { key: 'rowan-claim-1' });
  check('rowan claim ok', claim.status === 201 && claim.json.heldByYou === true);
  const devClaim = await call('POST', `/api/link/seed-buyer-dev-91ae57f3/slots/${rowanSlot}/claim`, {}, { key: 'dev-claim-1' });
  check('dev claim slot taken', devClaim.status === 409 && devClaim.json.error === 'slot_taken');
  const againHolding = await call('POST', `/api/link/seed-buyer-rowan-7f3c9a1e/slots/${rowanSlot}/claim`, {}, { key: 'rowan-claim-2' });
  check('already holding slot', againHolding.status === 409 && againHolding.json.error === 'already_holding_slot');
  const release = await call('POST', `/api/link/seed-buyer-rowan-7f3c9a1e/slots/${rowanSlot}/release`, {});
  check('release ok', release.status === 200 && release.json.held === false);
  const devRelease = await call('POST', `/api/link/seed-buyer-dev-91ae57f3/slots/${rowanSlot}/release`, {});
  check('not slot holder 403', devRelease.status === 403 && devRelease.json.error === 'not_slot_holder');

  // ---- revoke frees slot and keeps offer
  const rowanLinks = await call('GET', `/api/owner/cars/${car1.id}/links`);
  const rowanLink = rowanLinks.json.links.find((l) => l.name === 'Rowan Hale');
  await call('POST', `/api/link/seed-buyer-rowan-7f3c9a1e/slots/${rowanSlot}/claim`, {}, { key: 'rowan-claim-3' });
  const revoke = await call('POST', `/api/owner/links/${rowanLink.id}/revoke`, {});
  check('revoke ok', revoke.status === 200 && revoke.json.status === 'revoked');
  const ended = await call('GET', '/api/link/seed-buyer-rowan-7f3c9a1e');
  check('revoked link 410', ended.status === 410 && ended.json.error === 'link_revoked');
  const slotsAfter = await call('GET', `/api/owner/cars/${car1.id}/slots`);
  const freedSlot = slotsAfter.json.slots.find((s) => s.id === rowanSlot);
  check('revoke freed slot', freedSlot.held === false);
  const offersAfter = await call('GET', `/api/owner/cars/${car1.id}/offers`);
  check('rowan offer stays with owner', offersAfter.json.offers.some((o) => o.buyerName === 'Rowan Hale' && o.status === 'open'));

  // ---- accept: one acceptance, others closed
  const rowanOffer = offersAfter.json.offers.find((o) => o.buyerName === 'Rowan Hale');
  const accept = await call('POST', `/api/owner/offers/${rowanOffer.id}/accept`, {}, { key: `accept-${rowanOffer.id}` });
  check('accept closes others', accept.status === 200 && accept.json.offer.status === 'accepted' && accept.json.listingStatus === 'under_offer');
  check('imogen offer closed', accept.json.closedOfferIds.length >= 1);
  const offersAfter2 = await call('GET', `/api/owner/cars/${car1.id}/offers`);
  const imogenOffer = offersAfter2.json.offers.find((o) => o.buyerName === 'Imogen Achebe');
  check('imogen closed by another acceptance', imogenOffer.status === 'closed_by_acceptance');
  const acceptReplay = await call('POST', `/api/owner/offers/${rowanOffer.id}/accept`, {}, { key: `accept-${rowanOffer.id}` });
  check('accept replay returns stored success', acceptReplay.status === 200 && acceptReplay.json.offer.status === 'accepted');
  const acceptAgain = await call('POST', `/api/owner/offers/${rowanOffer.id}/accept`, {}, { key: 'accept-new-key' });
  check('accept again refused', acceptAgain.status === 409 && acceptAgain.json.error === 'offer_already_accepted');

  // ---- complete sale
  const complete = await call('POST', `/api/owner/cars/${car1.id}/complete`);
  check('sale complete', complete.status === 201 && complete.json.listingStatus === 'sold');
  const completeAgain = await call('POST', `/api/owner/cars/${car1.id}/complete`);
  check('second completion refused', completeAgain.status === 409 && completeAgain.json.error === 'illegal_transition');
  const handover = await call('GET', `/api/owner/cars/${car1.id}/handover`);
  check('handover pdf', handover.status === 200 && handover.text.slice(0, 5) === '%PDF-');
  const rowanHandover = await fetch(base + '/api/link/seed-buyer-rowan-7f3c9a1e/handover');
  check('revoked link cannot read handover', rowanHandover.status === 410);

  // ---- closed listing: claims and offers refused
  const slotsNow = await call('GET', `/api/owner/cars/${car1.id}/slots`);
  const anyFree = slotsNow.json.slots.find((s) => s.held === false);
  const devClaimClosed = await call('POST', `/api/link/seed-buyer-dev-91ae57f3/slots/${anyFree.id}/claim`, {}, { key: 'dev-claim-2' });
  check('claim on closed listing', devClaimClosed.status === 409 && devClaimClosed.json.error === 'listing_closed');

  // ---- report and versions
  const versions = await call('GET', `/api/owner/cars/${car1.id}/versions`);
  check('version 1 exists', versions.json.versions.length === 1 && versions.json.versions[0].number === 1);
  const report = await call('GET', `/api/owner/cars/${car1.id}/report/1`);
  check('report pdf', report.status === 200 && report.text.slice(0, 5) === '%PDF-');
  const buyerReport = await fetch(base + '/api/link/seed-buyer-imogen-42d8b06c/report');
  check('buyer report pdf', buyerReport.status === 200);

  // ---- photos
  const photoView = await fetch(base + '/api/link/seed-buyer-imogen-42d8b06c');
  const photoLink = (await photoView.json()).findings.find((f) => f.photoId).photoId;
  const photo = await fetch(base + `/api/link/seed-buyer-imogen-42d8b06c/photos/${photoLink}`);
  const photoBytes = Buffer.from(await photo.arrayBuffer());
  check('buyer photo jpeg', photo.status === 200 && photoBytes[0] === 0xff && photoBytes[1] === 0xd8);
  const gpsInBuyerCopy = photoBytes.indexOf(Buffer.from('GPS')) !== -1;
  check('no GPS in buyer copy', !gpsInBuyerCopy);

  // ---- inspector capture
  const inspectorView = await fetch(base + '/api/link/seed-inspector-tam-2b81d4c6').then(r => r.json());
  check('inspector view minimal', inspectorView.role === 'inspector' && inspectorView.car.maskedRegistration === 'S4*****' && inspectorView.findings === undefined);
  const batch = crypto.randomUUID();
  const clientId1 = crypto.randomUUID();
  const sameStamp = new Date('2026-11-12T10:00:00Z').toISOString();
  const cap1 = await call('POST', '/api/link/seed-inspector-tam-2b81d4c6/capture', { batchId: batch, items: [
    { clientId: clientId1, kind: 'reading', panelId: 'os-sill', microns: 431, capturedAt: sameStamp },
  ] });
  check('capture applied', cap1.status === 200 && cap1.json.results[0].state === 'applied');
  const cap2 = await call('POST', '/api/link/seed-inspector-tam-2b81d4c6/capture', { batchId: batch, items: [
    { clientId: clientId1, kind: 'reading', panelId: 'os-sill', microns: 431, capturedAt: sameStamp },
  ] });
  check('capture duplicate', cap2.status === 200 && cap2.json.results[0].state === 'duplicate', JSON.stringify(cap2.json).slice(0,200));
  const cap3 = await call('POST', '/api/link/seed-inspector-tam-2b81d4c6/capture', { batchId: batch, items: [
    { clientId: clientId1, kind: 'reading', panelId: 'os-sill', microns: 500, capturedAt: new Date().toISOString() },
  ] });
  check('capture conflict', cap3.json.results[0].state === 'conflict');
  const cap4 = await call('POST', '/api/link/seed-inspector-tam-2b81d4c6/capture', { batchId: batch, items: [
    { clientId: crypto.randomUUID(), kind: 'reading', panelId: 'rear-bumper', microns: 100, capturedAt: new Date().toISOString() },
  ] });
  check('plastic capture rejected', cap4.json.results[0].state === 'rejected');

  // readings side by side for buyer: no inspector name
  const buyerPanels = await fetch(base + '/api/link/seed-buyer-imogen-42d8b06c').then(r => r.json());
  const sillPanel = buyerPanels.panels.find((p) => p.id === 'os-sill');
  check('inspector reading without name for buyer', sillPanel.inspector.length === 1 && sillPanel.inspector[0].name === undefined && sillPanel.inspector[0].microns === 431);

  // ---- wrong role
  const wrongRole = await call('POST', '/api/link/seed-inspector-tam-2b81d4c6/seen', { findingId: 'x' });
  check('inspector cannot write seen', wrongRole.status === 403 && wrongRole.json.error === 'wrong_role');

  // ---- unknown link
  const unknown = await call('GET', '/api/link/not-a-real-token');
  check('unknown link 404', unknown.status === 404 && unknown.json.error === 'link_not_found');

  // ---- server boundary
  const bigBody = 'x'.repeat(70000);
  const tooBig = await fetch(base + '/api/owner/cars', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: bigBody }) });
  check('oversized body 413', tooBig.status === 413);
  const wrongType = await fetch(base + '/api/owner/cars', { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: 'hello' });
  check('wrong content type 415', wrongType.status === 415);
  const crossOrigin = await fetch(base + '/api/owner/cars', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example', Cookie: cookie }, body: '{}' });
  check('cross origin refused', crossOrigin.status === 403);
  const srcLeak = await fetch(base + '/src/server/api.ts');
  check('source files never served', srcLeak.status === 404);
  const manifestLeak = await fetch(base + '/run.json');
  check('manifest never served', manifestLeak.status === 404);
  const envLeak = await fetch(base + '/package.json');
  check('package files never served', envLeak.status === 404);

  // ---- sign out ends session
  const out = await call('DELETE', '/api/owner/session');
  check('sign out 204', out.status === 204);
  cookie = '';
  const afterOut = await call('GET', '/api/owner/cars');
  check('owner routes refuse after sign out', afterOut.status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
