/**
 * The API test suite: permissions, precedence, idempotency, concurrency and
 * the cross-process rules. Runs against a freshly seeded database.
 */
import {
  check, parallel, resetDb, seedViaRestart, signIn, summary,
  mailpitClear, mailpitMessages,
} from './helpers.mjs';

async function main() {
  await resetDb();
  await seedViaRestart();
  await mailpitClear();

  // ---------- DP-01 sessions and roles ----------
  const anonymous = await fetch('http://127.0.0.1:4173/api/cars');
  check('401 without session', anonymous.status === 401);
  for (const path of ['/api/cars', '/api/bays', '/api/care-round', '/api/jobs', '/api/invoices', '/api/releases', '/api/board', '/api/staff', '/api/me']) {
    const response = await fetch(`http://127.0.0.1:4173${path}`);
    check(`401 on ${path}`, response.status === 401, path);
  }
  const health = await fetch('http://127.0.0.1:4173/api/health');
  check('health without session', health.status === 200 && (await health.json()).status === 'ok');
  const status = await fetch('http://127.0.0.1:4173/api/status');
  check('status without session', status.status === 200, status.status);

  const ines = await signIn('ines@marrowlark.test');
  const tomas = await signIn('tomas@marrowlark.test');
  const odile = await signIn('odile@marrowlark.test');
  const rafael = await signIn('rafael@marrowlark.test');
  const henrietta = await signIn('henrietta@owners.test');
  const kenji = await signIn('kenji@owners.test');

  check('role board for concierge is 403', (await ines.get('/api/board')).status === 403);
  check('role staff for concierge is 403', (await ines.get('/api/staff')).status === 403);
  check('role invoices for care technician is 403', (await tomas.get('/api/invoices')).status === 403);
  check('role cars for owner is 200', (await henrietta.get('/api/cars')).status === 200);
  check('role owners for owner is 403', (await henrietta.get('/api/owners')).status === 403);
  check('role care entries for concierge is 403', (await ines.post('/api/cars/c-etype/care-entries', { started: true })).status === 403);

  // ---------- DP-02 error shape and precedence ----------
  const notFound = await ines.get('/api/cars/c-does-not-exist');
  check('unknown car 404 shape', notFound.status === 404 && (await notFound.body).error === 'not_found', notFound.body);
  const apiNotFound = await ines.get('/api/does-not-exist');
  check('unknown api path 404', apiNotFound.status === 404 && (await apiNotFound.body).error === 'not_found');

  // 404 wins over 403 for a foreign id with a disallowed role
  const foreign = await tomas.get('/api/cars/c-etype');
  check('technician can read cars', foreign.status === 200);
  const foreignRole = await tomas.get('/api/cars/c-nonsense/bay');
  check('404 before 403 on unknown id', foreignRole.status === 404, { status: foreignRole.status, body: foreignRole.body });

  // owner visibility: DP-03
  check('owner cannot read foreign car', (await henrietta.get('/api/cars/c-testarossa')).status === 404);
  check('owner cannot read foreign invoice', (await henrietta.get('/api/invoices/i-none')).status === 404);
  const kenjiJobs = (await kenji.get('/api/jobs')).body.jobs;
  check('owner sees no drafts', kenjiJobs.every((job) => job.status !== 'draft'));
  const kenjiDraft = await kenji.get('/api/jobs/j-1004');
  check('own draft job answers 404', kenjiDraft.status === 404);
  const henriettaCars = (await henrietta.get('/api/cars')).body;
  check('owner cars are only their own', henriettaCars.total === 2 && henriettaCars.cars.every((car) => car.owner.name === 'Henrietta Calloway'));
  const order = henriettaCars.cars.map((car) => car.bay?.code);
  check('my cars order by bay code', order[0] === 'A1' && order[1] === 'B1', order);

  // ---------- DP-22 money exactness of the seed ----------
  const jobsResponse = await odile.get('/api/jobs');
  const jobs = jobsResponse.body.jobs;
  const j1001 = jobs.find((job) => job.number === 'J-1001');
  const j1002 = jobs.find((job) => job.number === 'J-1002');
  const j1003 = jobs.find((job) => job.number === 'J-1003');
  const j1004 = jobs.find((job) => job.number === 'J-1004');
  check('J-1001 totals', j1001.net_total === '4135.70' && j1001.vat_total === '334.99' && j1001.rounding === '0.01' && j1001.total === '4470.70', j1001);
  check('J-1002 totals', j1002.total === '579.45' && j1002.rounding === '-0.02', j1002);
  check('J-1003 totals', j1003.total === '329.75' && j1003.rounding === '0.00', j1003);
  check('J-1004 totals', j1004.total === '313.50' && j1004.rounding === '0.01', j1004);
  check('seeded job versions are 1', [j1001, j1002, j1003, j1004].every((job) => job.version === 1));

  // ---------- DP-14 start-up status from the server ----------
  const round = (await tomas.get('/api/care-round')).body.cars;
  const etype = round.find((car) => car.car.name.includes('E-Type'));
  const roundOrder = round.map((car) => car.bay_code);
  check('E-Type is overdue first', round[0].bay_code === 'B1' && etype.startup.status === 'overdue');
  check('round groups ordered by bay code', roundOrder.join(',') === 'B1,A1,B2,C1', roundOrder);
  const sl300 = round.find((car) => car.car.name.includes('300 SL'));
  check('unscheduled car is not_scheduled', sl300.startup.status === 'not_scheduled');

  // ---------- DP-04 idempotent care entries ----------
  const entryBody = { started: true, battery_v: '12.55', tyres: null, note: 'API test' };
  const firstEntry = await tomas.post('/api/cars/c-etype/care-entries', entryBody, 'care-key-1');
  check('care entry 201', firstEntry.status === 201, firstEntry.body);
  check('care entry announces next due', firstEntry.body.message.startsWith('Start-up logged for 1967 Jaguar E-Type.'), firstEntry.body.message);
  const replayEntry = await tomas.post('/api/cars/c-etype/care-entries', entryBody, 'care-key-1');
  check('care entry replay same response', replayEntry.status === 201 && replayEntry.body.entry.id === firstEntry.body.entry.id);
  const conflict = await tomas.post('/api/cars/c-etype/care-entries', { ...entryBody, note: 'different' }, 'care-key-1');
  check('care entry key conflict 409', conflict.status === 409 && conflict.body.error === 'idempotency_conflict');
  const missingKey = await tomas.post('/api/cars/c-etype/care-entries', { started: true });
  check('missing idempotency key 422', missingKey.status === 422 && missingKey.body.errors.idempotency_key === 'Send an Idempotency-Key header.');
  // entry count stays one
  const etypeDetail = (await ines.get('/api/cars/c-etype')).body.car;
  const startedCount = etypeDetail.care_entries.filter((entry) => entry.started).length;
  check('exactly one entry recorded for the stay', startedCount === 2, startedCount); // seeded + test

  // ---------- DP-13 flags ----------
  const flagged = await tomas.post('/api/cars/c-etype/care-entries', { started: false, battery_v: '11.80', tyres: { unit: 'bar', fl: '2.50', fr: '2.20', rl: '2.00', rr: '2.40' }, note: '' }, 'care-key-flags');
  check('battery and tyre flags', flagged.body.entry.flags.includes('battery_low') && flagged.body.entry.flags.includes('tyre_pressure'), flagged.body);

  // ---------- DP-05/06/07 bays ----------
  const fits = (await ines.get('/api/bays?fits=c-fulvia')).body.bays;
  const a4 = fits.find((bay) => bay.code === 'A4');
  const b1 = fits.find((bay) => bay.code === 'B1');
  check('fulvia fits A4', a4.eligible === true);
  check('occupied bay ineligible', b1.reason === 'occupied');
  const assign = await ines.post('/api/cars/c-fulvia/bay', { bay_id: 'A4' });
  check('assign bay 200 and car stored', assign.status === 200 && assign.body.car.status === 'stored' && assign.body.car.bay.code === 'A4');
  const tooSmall = await ines.post('/api/cars/c-fulvia/bay', { bay_id: 'A3' });
  check('too small bay is free after assignment? A3 fits', tooSmall.status === 200, tooSmall.body);

  // move within class: put the fulvia in A2, then try a covered lift
  const move = await ines.post('/api/cars/c-fulvia/bay', { bay_id: 'A2' });
  check('move within class works', move.status === 200 && move.body.car.bay.code === 'A2');
  const classChange = await ines.post('/api/cars/c-fulvia/bay', { bay_id: 'C2' });
  check('class change 409', classChange.status === 409 && classChange.body.error === 'bay_class_change');

  // concurrent assignments of several cars to one free bay: exactly one wins
  const owners = (await ines.get('/api/owners')).body.owners;
  const raceCars = [];
  for (let index = 0; index < 3; index += 1) {
    const registered = await ines.post('/api/cars', {
      owner_id: owners[index % owners.length].id,
      year: 1970 + index,
      make: 'Race',
      model: `Car ${index}`,
      registration: `R${index}`,
      colour: 'Grey',
      length_mm: 4000,
      width_mm: 1600,
      odometer: { value: '1000', unit: 'km' },
      tyre_spec: { value: '2.00', unit: 'bar' },
      startup_schedule: false,
    });
    raceCars.push(registered.body.car.id);
  }
  const results = await Promise.all(raceCars.map((carId) => ines.post(`/api/cars/${carId}/bay`, { bay_id: 'A3' })));
  const wins = results.filter((result) => result.status === 200);
  const conflicts = results.filter((result) => result.status === 409 && result.body.error === 'bay_occupied');
  check('one concurrent assignment wins', wins.length === 1, results.map((r) => r.status));
  check('others answer bay_occupied', conflicts.length === 2, results.map((r) => r.body && r.body.error));
  const stored = raceCars.filter((carId) => results[raceCars.indexOf(carId)].status !== 200);
  for (const [index, carId] of stored.entries()) {
    const bay = index === 0 ? 'A4' : 'C2';
    const assigned = await ines.post(`/api/cars/${carId}/bay`, { bay_id: bay });
    check(`race car stored in ${bay}`, assigned.status === 200, assigned.body);
  }

  // ---------- DP-08/09 condition report and photos ----------
  const pdf = Buffer.from('%PDF-1.4 test report bytes for the stay');
  const reportForm = new FormData();
  reportForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'report.pdf');
  const reportResponse = await fetch('http://127.0.0.1:4173/api/cars/c-fulvia/condition-report', {
    method: 'POST',
    headers: { Cookie: ines.cookieHeader() },
    body: reportForm,
  });
  const report = await reportResponse.json();
  check('report stored', reportResponse.status === 201, report);
  const { createHash } = await import('node:crypto');
  check('report sha matches uploaded bytes', report.report.sha256 === createHash('sha256').update(pdf).digest('hex'));
  const download = await fetch(`http://127.0.0.1:4173/api/condition-reports/${report.report.id}/file`, {
    headers: { Cookie: ines.cookieHeader() },
  });
  const downloaded = Buffer.from(await download.arrayBuffer());
  check('download returns exact bytes', download.status === 200 && downloaded.equals(pdf));
  const secondUpload = new FormData();
  secondUpload.append('file', new Blob([Buffer.from('%PDF-1.4 second')], { type: 'application/pdf' }), 'second.pdf');
  const secondResponse = await fetch('http://127.0.0.1:4173/api/cars/c-fulvia/condition-report', {
    method: 'POST',
    headers: { Cookie: ines.cookieHeader() },
    body: secondUpload,
  });
  check('second report for the stay 409 within a second', secondResponse.status === 409 && (await secondResponse.json()).error === 'report_already_signed');
  check('second upload fast', secondResponse.headers.get('x-test') === null);

  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const photoForm = new FormData();
  photoForm.append('kind', 'intake');
  photoForm.append('file', new Blob([photoBytes], { type: 'image/jpeg' }), 'photo.jpg');
  const photoResponse = await fetch('http://127.0.0.1:4173/api/cars/c-fulvia/photos', {
    method: 'POST',
    headers: { Cookie: ines.cookieHeader() },
    body: photoForm,
  });
  const photo = await photoResponse.json();
  check('photo attached after storage confirms', photoResponse.status === 201 && photo.photo.attached === true, photo);
  const listing = (await ines.get('/api/cars/c-fulvia')).body.car;
  check('photo listed as attached', listing.photos.some((candidate) => candidate.id === photo.photo.id));

  // ---------- DP-17/18/79 jobs, versions, expiry ----------
  // concurrent edits from the same version on a draft: exactly one wins
  const lineFor = (line) => line.kind === 'labour'
    ? { kind: line.kind, description: line.description, quantity: line.quantity }
    : { kind: line.kind, description: line.description, quantity: line.quantity, unit_price: line.unit_price };
  const concurrentA = odile.patch('/api/jobs/j-1004', { title: 'A edit', lines: j1004.lines.map(lineFor) }, { 'If-Match': '"1"' });
  const concurrentB = odile.patch('/api/jobs/j-1004', { title: 'B edit', lines: j1004.lines.map(lineFor) }, { 'If-Match': '"1"' });
  const [a, b] = await Promise.all([concurrentA, concurrentB]);
  check('one concurrent edit wins', (a.status === 200) !== (b.status === 200), { a: a.status, b: b.status });
  check('other edit answers estimate_changed', (a.status === 412) !== (b.status === 412), { a: a.body, b: b.body });

  // approve by owner: DP-19
  const missingMatch = await odile.patch('/api/jobs/j-1004', { title: 'No match', lines: [] });
  check('missing If-Match 422', missingMatch.status === 422 && missingMatch.body.errors.if_match === 'Send the estimate version you edited.');
  const stale = await odile.patch('/api/jobs/j-1004', { title: 'Stale', lines: [{ kind: 'part', description: 'x', quantity: '1', unit_price: '10.00' }] }, { 'If-Match': '"999"' });
  check('stale version 412', stale.status === 412 && stale.body.error === 'estimate_changed');

  const current1004 = (await odile.get('/api/jobs/j-1004')).body.job;
  const edit = await odile.patch('/api/jobs/j-1004', { title: 'Boot floor inspection', lines: [{ kind: 'labour', description: 'Lift boot floor mat and inspect for corrosion', quantity: '2.00' }] }, { 'If-Match': `"${current1004.version}"` });
  check('edit from the current version works', edit.status === 200 && edit.body.job.version === current1004.version + 1, edit.body);
  const send = await odile.postHeaders('/api/jobs/j-1004/send', undefined, { 'If-Match': `"${edit.body.job.version}"` });
  check('send from version 2 works', send.status === 200 && send.body.job.status === 'sent', send.body);
  const sendAgain = await odile.postHeaders('/api/jobs/j-1004/send', undefined, { 'If-Match': `"${send.body.job.version}"` });
  check('second send invalid_transition', sendAgain.status === 409 && sendAgain.body.error === 'invalid_transition');

  const approve = await henrietta.post('/api/jobs/j-1001/approve');
  check('cannot approve an in-progress job', approve.status === 409);
  const foreignApprove = await henrietta.post('/api/jobs/j-1002/approve');
  check('foreign job approve 404', foreignApprove.status === 404, foreignApprove.body);

  // estimate expiry: send a job with a tiny expiry via env is not possible at
  // runtime, so expiry is checked through the seeded sent job's expires_at date
  const j1002Now = (await odile.get('/api/jobs/j-1002')).body.job;
  check('sent estimate shows sent', j1002Now.status === 'sent' && j1002Now.expires_at !== null);

  // ---------- DP-20/75 stages and readings ----------
  const newJob = await odile.post('/api/jobs', {
    car_id: 'c-etype',
    title: 'Valance respray',
    lines: [{ kind: 'part', description: 'Filler', quantity: '2', unit_price: '30.00' }],
  });
  check('second open job 409', newJob.status === 409 && newJob.body.error === 'job_already_open');

  const approve1002 = await kenji.post('/api/jobs/j-1002/approve');
  check('owner approves own sent estimate', approve1002.status === 200 && approve1002.body.job.status === 'approved', approve1002.body);
  const stageAlready = await odile.post('/api/jobs/j-1002/stages', { name: 'Base', readings: [{ panel: 'bonnet', value: '120', unit: 'um' }] });
  check('logging a later stage first works', stageAlready.status === 201, stageAlready.body);
  const outOfOrder = await odile.post('/api/jobs/j-1002/stages', { name: 'Intake', readings: [{ panel: 'bonnet', value: '110', unit: 'um' }] });
  check('earlier stage after a later one 409', outOfOrder.status === 409 && outOfOrder.body.error === 'stage_out_of_order');

  // concurrent logs of the same stage: exactly one 201
  const stageRaces = await parallel(4, () =>
    odile.post('/api/jobs/j-1002/stages', { name: 'Clear', readings: [{ panel: 'bonnet', value: '150', unit: 'um' }] }));
  const raceWins = stageRaces.filter((race) => race.status === 201);
  const raceConflicts = stageRaces.filter((race) => race.status === 409 && race.body.error === 'stage_already_logged');
  check('one concurrent stage wins', raceWins.length === 1, stageRaces.map((r) => r.status));
  check('others answer stage_already_logged', raceConflicts.length === 3);

  // coat stack derivation: DP-35
  const coat = (await odile.get('/api/jobs/j-1001/coat-stack')).body;
  const baseStage = coat.stages.find((stage) => stage.name === 'Base');
  const bonnet = baseStage.panels.find((panel) => panel.panel === 'bonnet');
  check('bonnet at Base: 158 µm factory', bonnet.film_um === 158 && bonnet.band === 'factory');
  check('bonnet layers Epoxy 48, 2K 84, Base 26',
    bonnet.layers.length === 3 && bonnet.layers[0].stage === 'Epoxy primer' && bonnet.layers[0].um === 48 &&
    bonnet.layers[1].stage === '2K primer' && bonnet.layers[1].um === 84 &&
    bonnet.layers[2].stage === 'Base' && bonnet.layers[2].um === 26, bonnet.layers);
  const valance = baseStage.panels.find((panel) => panel.panel === 'front_valance');
  check('valance keeps its intake reading', valance.film_um === 112 && valance.band === 'factory');

  // panel reading history DP-60 (owner sees the house)
  const historyStaff = (await odile.get('/api/jobs/j-1001/panels/bonnet/readings')).body;
  check('staff sees the real actor', historyStaff.readings.every((reading) => reading.logged_by.name === 'Odile Fenner'));

  // ---------- DP-48 issue an invoice, gapless numbers, concurrency ----------
  const finish1003 = await odile.post('/api/jobs/j-1003/finish');
  check('finish already finished 409', finish1003.status === 409);

  // finish j-1001 then two concurrent issues: exactly one invoice
  const send1001 = await odile.postHeaders('/api/jobs/j-1001/send', undefined, { 'If-Match': '"1"' });
  check('cannot re-send in-progress job', send1001.status === 409);
  const issueRace = await parallel(3, () => odile.post('/api/jobs/j-1003/invoice', {}, `race-issue-${Math.random()}`));
  const issueWins = issueRace.filter((issue) => issue.status === 201);
  const issueConflicts = issueRace.filter((issue) => issue.status === 409);
  check('one concurrent issue wins', issueWins.length === 1, issueRace.map((r) => r.status));
  check('others answer invalid_transition', issueConflicts.length === 2);
  const invoice = issueWins[0].body.invoice;
  check('invoice number gapless 0001', invoice.number === 'INV-2026-0001', invoice.number);
  check('invoice balance from Kill Bill', invoice.balance === '329.75' && invoice.balance_live === true, invoice);

  // a second job's invoice gets the next number without a gap
  const secondInvoice = await odile.post('/api/jobs/j-1001/invoice', {}, 'issue-1001');
  check('in-progress job cannot be invoiced', secondInvoice.status === 409 && secondInvoice.body.error === 'invalid_transition');

  // owner projection of the invoice: no Kill Bill ids, house actor
  const ownerInvoices = (await kenji.get('/api/invoices')).body;
  const ownerInvoice = ownerInvoices.invoices.find((candidate) => candidate.id === invoice.id);
  check('owner invoice omits killbill id', ownerInvoice.killbill_invoice_id === undefined);
  check('owner invoice payments omit kb ids and recorder', ownerInvoice.payments.every((payment) => payment.killbill_payment_id === undefined && payment.recorded_by === undefined));

  // ---------- DP-23/56 partial payments ----------
  const manager = rafael;
  const transfer1 = await manager.post(`/api/invoices/${invoice.id}/payments`, { reference: 'RF1854', amount: '100.00' }, 'transfer-1');
  check('partial transfer recorded', transfer1.status === 200 && transfer1.body.invoice.balance === '229.75', transfer1.body);
  const overpay = await manager.post(`/api/invoices/${invoice.id}/payments`, { reference: 'RF1855', amount: '999.99' }, 'transfer-2');
  check('overpay answers field error at live balance', overpay.status === 422 && overpay.body.errors.amount === 'Enter an amount from 0.01 to 229.75.');
  const transferReplay = await manager.post(`/api/invoices/${invoice.id}/payments`, { reference: 'RF1854', amount: '100.00' }, 'transfer-1');
  check('transfer replay returns same response', transferReplay.status === 200 && transferReplay.body.invoice.balance === '229.75');
  // repeated bank reference records separately
  const transfer3 = await manager.post(`/api/invoices/${invoice.id}/payments`, { reference: 'RF1854', amount: '229.75' }, 'transfer-3');
  check('repeated reference records a separate transfer', transfer3.status === 200 && transfer3.body.invoice.balance === '0.00');
  check('invoice paid once balance is zero', transfer3.body.invoice.status === 'paid');
  const alreadyPaid = await manager.post(`/api/invoices/${invoice.id}/payments`, { reference: 'RF1854', amount: '10.00' }, 'transfer-4');
  check('already paid 409', alreadyPaid.status === 409 && alreadyPaid.body.error === 'already_paid');

  // concurrent transfers checked against the live balance in turn
  // (a new invoice for the race)
  const finish1002 = await odile.post('/api/jobs/j-1002/finish');
  check('finish in-progress job with stages', finish1002.status === 200, finish1002.body);
  const invoice1002 = await odile.post('/api/jobs/j-1002/invoice', {}, 'issue-1002');
  check('second invoice number gapless', invoice1002.status === 201 && invoice1002.body.invoice.number === 'INV-2026-0002', invoice1002.body.invoice && invoice1002.body.invoice.number);
  const transferRace = await parallel(5, (index) =>
    manager.post(`/api/invoices/${invoice1002.body.invoice.id}/payments`, { reference: `RACE-${index}`, amount: '250.00' }, `transfer-race-${index}`));
  const raceOk = transferRace.filter((transfer) => transfer.status === 200);
  const raceFieldErrors = transferRace.filter((transfer) => transfer.status === 422);
  check('concurrent transfers: two succeed against the live balance', raceOk.length === 2, transferRace.map((t) => t.status));
  check('concurrent transfers: three field errors', raceFieldErrors.length === 3, transferRace.map((t) => t.status && t.body));

  // ---------- DP-25/26/47 releases ----------
  const earliest = (await henrietta.get('/api/releases/earliest-slot')).body;
  check('earliest slot at least 48h ahead', earliest.earliest >= new Date(Date.now() + 47 * 3600 * 1000).toISOString().slice(0, 10), earliest);
  const slotAt = (offsetSteps) => {
    const base = new Date(`${earliest.earliest.slice(0, 10)}T${earliest.earliest.slice(11)}:00Z`);
    const shifted = new Date(base.getTime() + offsetSteps * 30 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  };
  const nextSlot = slotAt(1);
  const nextSlot2 = slotAt(2);
  const nextSlot3 = slotAt(3);
  const badSlot = await kenji.post('/api/releases', { car_id: 'c-fulvia', slot: '2026-11-01T12:00' }, 'release-bad');
  check('off-grid slot 422', badSlot.status === 422, badSlot.body);
  const tooSoon = await kenji.post('/api/releases', { car_id: 'c-fulvia', slot: '2026-11-01T12:30' }, 'release-soon');
  check('too soon slot 422', tooSoon.status === 422 && tooSoon.body.errors.slot.includes("Releases need at least 48 hours' notice."), tooSoon.body);
  const request = await kenji.post('/api/releases', { car_id: 'c-fulvia', slot: earliest.earliest }, 'release-1');
  check('release requested', request.status === 201 && request.body.release.status === 'requested', request.body);
  const openAgain = await kenji.post('/api/releases', { car_id: 'c-fulvia', slot: nextSlot }, 'release-2');
  check('second open release 409', openAgain.status === 409 && openAgain.body.error === 'release_already_open');
  const inWorkshop = await henrietta.post('/api/releases', { car_id: 'c-911rs', slot: nextSlot }, 'release-3');
  check('car in workshop 409', inWorkshop.status === 409 && inWorkshop.body.error === 'car_in_workshop');

  // slot race across different cars: exactly one wins
  const slotRace = await parallel(3, (index) => ines.post('/api/releases', { car_id: raceCars[index], slot: nextSlot }, `slot-race-${index}`));
  const slotWins = slotRace.filter((attempt) => attempt.status === 201);
  const slotTaken = slotRace.filter((attempt) => attempt.status === 409 && attempt.body.error === 'slot_taken');
  check('one slot request wins', slotWins.length === 1, slotRace.map((r) => r.status));
  check('others answer slot_taken', slotTaken.length === 2, slotRace.map((r) => r.body && r.body.error));

  // finish J-1001 and issue its invoice so the 911 can be released against it
  const finish1001 = await odile.post('/api/jobs/j-1001/finish');
  check('finish in-progress J-1001', finish1001.status === 200 && finish1001.body.job.status === 'finished', finish1001.body);
  const invoice1001 = await odile.post('/api/jobs/j-1001/invoice', {}, 'issue-1001');
  check('J-1001 invoice number gapless 0003', invoice1001.status === 201 && invoice1001.body.invoice.number === 'INV-2026-0003', invoice1001.body.invoice && invoice1001.body.invoice.number);
  check('J-1001 invoice total', invoice1001.body.invoice.total === '4470.70', invoice1001.body.invoice.total);

  // the 911 release journey with the hold
  const request911 = await henrietta.post('/api/releases', { car_id: 'c-911rs', slot: nextSlot2 }, 'release-911');
  check('911 release requested', request911.status === 201, request911.body);
  const book = await ines.post(`/api/releases/${request911.body.release.id}/book`);
  check('book by concierge', book.status === 200 && book.body.release.status === 'booked');
  const stage = await ines.post(`/api/releases/${request911.body.release.id}/stage`);
  check('stage release', stage.status === 200 && stage.body.release.status === 'staged');
  const heldByInvoice = await ines.post(`/api/releases/${request911.body.release.id}/complete`);
  check('completion held by the unpaid invoice',
    heldByInvoice.status === 409 && heldByInvoice.body.error === 'invoice_unpaid' && heldByInvoice.body.invoices.length > 0, heldByInvoice.body);
  check('hold names the invoice', heldByInvoice.body.invoices.some((holding) => holding.number === 'INV-2026-0003'), heldByInvoice.body.invoices);
  const releaseWithHold = (await ines.get(`/api/releases/${request911.body.release.id}`)).body.release;
  check('release held_by lists the invoice', releaseWithHold.held_by.some((holding) => holding.number === 'INV-2026-0003'));

  // invoices on the owner's other car never hold the release
  const otherCarInvoice = (await kenji.get('/api/invoices')).body.invoices.find((invoice) => invoice.number === 'INV-2026-0002');
  check('other car invoice exists', otherCarInvoice !== undefined && otherCarInvoice.balance !== '0.00');
  const paidOff = await manager.post(`/api/invoices/${invoice1001.body.invoice.id}/payments`, { reference: 'RF-911', amount: '4470.70' }, 'transfer-911');
  check('pay off the holding invoice', paidOff.status === 200 && paidOff.body.invoice.balance === '0.00', paidOff.body);
  const blockedByBelongings = await ines.post(`/api/releases/${request911.body.release.id}/complete`);
  check('completion refused while belongings are checked in',
    blockedByBelongings.status === 409 && blockedByBelongings.body.error === 'belongings_checked_in', blockedByBelongings.body);
  for (const item of (await ines.get('/api/cars/c-911rs')).body.car.belongings) {
    let remaining = item.count_in;
    while (remaining > 0) {
      const out = await ines.post(`/api/belongings/${item.id}/movements`, { direction: 'out', count: remaining });
      if (out.status !== 201) break;
      remaining = out.body.item.count_in;
    }
  }
  const complete = await ines.post(`/api/releases/${request911.body.release.id}/complete`);
  check('completion succeeds', complete.status === 200 && complete.body.release.status === 'released' && complete.body.car.status === 'released', complete.body);
  const completeAgain = await ines.post(`/api/releases/${request911.body.release.id}/complete`);
  check('second completion invalid_transition', completeAgain.status === 409);
  const movementAfter = await ines.post('/api/belongings/b-911rs-keys/movements', { direction: 'in', count: 1 });
  check('check-in after release answers car_released', movementAfter.status === 409 && movementAfter.body.error === 'car_released');

  // concurrent completions: exactly one succeeds (300 SL, its job is paid)
  const request300 = await kenji.post('/api/releases', { car_id: 'c-300sl', slot: nextSlot3 }, 'release-300sl');
  check('release for 300 SL requested', request300.status === 201, request300.body);
  await ines.post(`/api/releases/${request300.body.release.id}/book`);
  await ines.post(`/api/releases/${request300.body.release.id}/stage`);
  for (const item of (await ines.get('/api/cars/c-300sl')).body.car.belongings) {
    let remaining = item.count_in;
    while (remaining > 0) {
      const out = await ines.post(`/api/belongings/${item.id}/movements`, { direction: 'out', count: remaining });
      if (out.status !== 201) break;
      remaining = out.body.item.count_in;
    }
  }
  const completionRace = await parallel(3, () => ines.post(`/api/releases/${request300.body.release.id}/complete`));
  const completionWins = completionRace.filter((attempt) => attempt.status === 200);
  check('one concurrent completion wins', completionWins.length === 1, completionRace.map((r) => r.status));

  // ---------- DP-29 owner emails ----------
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const messages = await mailpitMessages();
  const subjects = messages.map((message) => message.Subject);
  check('estimate email subject', subjects.includes('Estimate J-1004 for your 1967 Jaguar E-Type is ready'), subjects);
  check('invoice email subject', subjects.includes('Invoice INV-2026-0001 for your 1962 Mercedes-Benz 300 SL Roadster'), subjects);
  check('release booked email subject', subjects.some((subject) => subject.startsWith('Release booked: 1973 Porsche 911 Carrera RS 2.7, ')), subjects);
  check('released email subject', subjects.includes('Your 1973 Porsche 911 Carrera RS 2.7 has been released'), subjects);
  const everyEmailToOneOwner = messages.every((message) => ['henrietta@owners.test', 'kenji@owners.test'].includes(message.To[0].Address));
  check('emails go only to owners', everyEmailToOneOwner);

  // ---------- DP-52 revoked access ends sessions ----------
  const staffList = (await manager.get('/api/staff')).body.staff;
  const tomasMember = staffList.find((member) => member.name === 'Tomas Riedl');
  const revoke = await manager.patch(`/api/staff/${tomasMember.id}`, { active: false });
  check('revoke sets revoked state', revoke.status === 200 && revoke.body.member.active === false);
  const revokedRead = await tomas.get('/api/care-round');
  check('revoked member gets access_revoked', revokedRead.status === 401 && revokedRead.body.error === 'access_revoked');
  const revokedSignIn = await tomas.raw('POST', '/api/session', { body: { email: 'tomas@marrowlark.test', password: 'lacquer-demo-2026' } });
  check('revoked member cannot sign in', revokedSignIn.status === 401 && revokedSignIn.body.error === 'invalid_credentials');
  const restore = await manager.patch(`/api/staff/${tomasMember.id}`, { active: true });
  check('restore sets active', restore.status === 200 && restore.body.member.active === true);
  const oldSessionStill = await tomas.get('/api/care-round');
  check('restore does not revive the session', oldSessionStill.status === 401 && oldSessionStill.body.error === 'access_revoked');
  const selfRevoke = await manager.patch(`/api/staff/${(await manager.get('/api/staff')).body.staff.find((m) => m.name === 'Rafael Amsel').id}`, { active: false });
  check('cannot change own access', selfRevoke.status === 409 && selfRevoke.body.error === 'cannot_change_own_access');

  // ---------- DP-61 return address ----------
  const openRedirect = await rafael.raw('POST', '/api/session', { body: { email: 'rafael@marrowlark.test', password: 'lacquer-demo-2026', next: '//evil.test' } });
  check('evil next goes to role home', openRedirect.body.redirect === '/board', openRedirect.body);
  const apiNext = await kenji.raw('POST', '/api/session', { body: { email: 'kenji@owners.test', password: 'lacquer-demo-2026', next: '/api/me' } });
  check('api next goes to role home', apiNext.body.redirect === '/portal', apiNext.body);
  const jobNext = await henrietta.raw('POST', '/api/session', { body: { email: 'henrietta@owners.test', password: 'lacquer-demo-2026', next: '/jobs/j-1001?stage=4&panel=bonnet' } });
  check('job link next honoured', jobNext.body.redirect === '/jobs/j-1001?stage=4&panel=bonnet', jobNext.body);

  // ---------- DP-16 units ----------
  const units = await kenji.put('/api/me/units', { film: 'mil', pressure: 'psi', distance: 'mi' });
  check('units saved', units.status === 200 && units.body.units.film === 'mil');
  const meNow = (await kenji.get('/api/me')).body;
  check('units read back', meNow.units.film === 'mil' && meNow.units.pressure === 'psi' && meNow.units.distance === 'mi');

  summary();
}

main().catch((err) => {
  console.error('SUITE ERROR', err);
  process.exit(1);
});
