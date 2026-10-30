/** Development checks for the rules that are easy to get subtly wrong. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

async function call(cookie, path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie !== null) headers.cookie = cookie;
  let body;
  if (options.form !== undefined) body = options.form;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, { method: options.method ?? 'GET', headers, body });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pegboard-2026' }),
  });
  return response.headers.getSetCookie()[0].split(';')[0];
}

let keyCounter = 0;
const key = () => `verify-${Date.now()}-${(keyCounter += 1)}`;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const main = async () => {
  const rosa = await signIn('rosa@commonshed.example');
  const dev = await signIn('dev@commonshed.example');
  const library = (await call(rosa, '/api/library')).json;
  const closed = new Set(library.closed_dates);
  const open = new Set(library.open_days);
  const lanes = (await call(rosa, '/api/items/tile-saw/lanes')).json;
  const todayDate = lanes.from;

  const isOpen = (date) => open.has(WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]) && !closed.has(date);
  const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const openDates = [];
  for (let offset = 0; offset < 28; offset += 1) {
    const date = shift(todayDate, offset);
    if (isOpen(date)) openDates.push(date);
  }

  // ---- Late fees, closures and clock changes, through back-timed walk-ins. ----
  const members = (await call(dev, '/api/members')).json.members;
  check('members listed by name', members.length === 6 && members[0].name === 'Hal Brennan', members);

  const lateCases = [
    {
      label: 'closure dates',
      unit: 'post-hole-digger-1',
      member: 'mem-juno',
      checkedOutAt: '2026-07-01T14:00:00Z',
      dueDate: '2026-07-03',
      returnedAt: '2026-07-07T16:00:00Z',
      lateDays: 2,
      lateFee: 100,
    },
    {
      label: 'rate change',
      unit: 'stud-finder-1',
      member: 'mem-juno',
      checkedOutAt: '2026-08-27T14:00:00Z',
      dueDate: '2026-08-29',
      returnedAt: '2026-09-02T16:00:00Z',
      lateDays: 3,
      lateFee: 200,
    },
    {
      label: 'spring clock change',
      unit: 'stud-finder-2',
      member: 'mem-juno',
      checkedOutAt: '2026-03-05T15:00:00Z',
      dueDate: '2026-03-07',
      returnedAt: '2026-03-10T22:30:00Z',
      lateDays: 3,
      lateFee: 150,
    },
    {
      label: 'spring clock change, just before closing',
      unit: 'hedge-trimmer-1',
      member: 'mem-juno',
      checkedOutAt: '2026-03-05T15:00:00Z',
      dueDate: '2026-03-07',
      returnedAt: '2026-03-10T21:59:00Z',
      lateDays: 2,
      lateFee: 100,
    },
    {
      label: 'late fee cap',
      unit: 'stud-finder-1',
      member: 'mem-wren',
      checkedOutAt: '2026-09-01T14:00:00Z',
      dueDate: '2026-09-03',
      returnedAt: '2026-10-20T16:00:00Z',
      cappedAt: 2499,
    },
  ];

  for (const testCase of lateCases) {
    const lent = await call(dev, '/api/loans', {
      method: 'POST',
      headers: { 'idempotency-key': key() },
      body: {
        member_id: testCase.member,
        unit_id: testCase.unit,
        due_date: testCase.dueDate,
        checked_out_at: testCase.checkedOutAt,
      },
    });
    if (lent.status !== 201) {
      check(`${testCase.label}: lent`, false, lent.json);
      continue;
    }
    const loanId = lent.json.loan.id;
    check(`${testCase.label}: overdue at once`, lent.json.loan.status === 'overdue', lent.json.loan.status);
    const returned = await call(dev, `/api/loans/${loanId}/return`, {
      method: 'POST',
      body: { returned_at: testCase.returnedAt },
    });
    check(`${testCase.label}: returned`, returned.status === 200, returned.json);
    if (testCase.lateDays !== undefined) {
      check(`${testCase.label}: late days`, returned.json.loan.late_days === testCase.lateDays, returned.json.loan.late_days);
    }
    check(`${testCase.label}: not on time`, returned.json.loan.on_time === false);
    await call(dev, `/api/loans/${loanId}/inspection`, { method: 'POST', body: { outcome: 'ok', note: '' } });
    const settled = await call(rosa, `/api/loans/${loanId}/settlement`, {
      method: 'POST',
      headers: { 'idempotency-key': key() },
      body: { damage_cents: 0 },
    });
    check(`${testCase.label}: settled`, settled.status === 201, settled.json);
    const expected = testCase.cappedAt ?? testCase.lateFee;
    check(`${testCase.label}: late fee`, settled.json.settlement?.late_fee_cents === expected, settled.json.settlement);
  }

  // ---- Due instant at the posted closing time. ----
  const novLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-tobi', unit_id: 'drill-driver-1', due_date: '2026-11-01' },
  });
  check('autumn due instant', novLoan.json.loan?.due_at === '2026-11-01T23:00:00.000Z', novLoan.json.loan?.due_at);
  const onTime = await call(dev, `/api/loans/${novLoan.json.loan.id}/return`, { method: 'POST', body: {} });
  check('return before closing is on time', onTime.json.loan.on_time === true && onTime.json.loan.late_days === 0, onTime.json.loan);

  // ---- back_on skips closure dates. ----
  const novSpan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-tobi', unit_id: 'drill-driver-2', due_date: '2026-11-01' },
  });
  check('loan for back_on', novSpan.status === 201, novSpan.json);
  const drillLanes = (await call(dev, '/api/items/drill-driver/lanes')).json;
  const span = drillLanes.lanes[1].spans[0];
  check('back_on is the next open day', span.back_on === '2026-11-03', span);
  check('staff see borrower', span.borrower?.name === 'Tobi Adeyemi', span);
  check('staff see record', span.record?.type === 'loan', span);
  await call(dev, `/api/loans/${novSpan.json.loan.id}/return`, { method: 'POST', body: {} });

  // ---- Borrowing pause. ----
  const sol = await signIn('sol@members.example');
  const overdue = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-sol', unit_id: 'laser-level-1', due_date: '2026-10-20', checked_out_at: '2026-10-18T14:00:00Z' },
  });
  check('back-timed overdue loan', overdue.json.loan?.status === 'overdue', overdue.json);
  const pausedHold = await call(sol, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'drill-driver', start_date: openDates[0], end_date: openDates[1] },
  });
  check('paused hold refused', pausedHold.status === 409 && pausedHold.json.error.code === 'borrowing_paused', pausedHold.json);
  const pausedWalkIn = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-sol', unit_id: 'drill-driver-3', due_date: openDates[1] },
  });
  check('paused walk-in refused', pausedWalkIn.json.error?.code === 'borrowing_paused', pausedWalkIn.json);
  await call(dev, `/api/loans/${overdue.json.loan.id}/return`, { method: 'POST', body: {} });
  const afterCheckIn = await call(sol, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'drill-driver', start_date: openDates[0], end_date: openDates[1] },
  });
  check('pause lifts at check-in', afterCheckIn.status === 201, afterCheckIn.json);
  await call(sol, `/api/holds/${afterCheckIn.json.hold.id}/cancel`, { method: 'POST', body: {} });

  // ---- Racing claims for the last units. ----
  const mina = await signIn('mina@members.example');
  const racers = await Promise.all(
    ['mem-hal', 'mem-mina', 'mem-tobi', 'mem-wren', 'mem-juno'].map(async (memberId) => {
      const email = {
        'mem-hal': 'hal@members.example',
        'mem-mina': 'mina@members.example',
        'mem-tobi': 'tobi@members.example',
        'mem-wren': 'wren@members.example',
        'mem-juno': 'juno@members.example',
      }[memberId];
      return signIn(email);
    }),
  );
  const raceStart = openDates[3];
  const raceEnd = openDates[4];
  const raceResults = await Promise.all(
    racers.map((cookie) =>
      call(cookie, '/api/holds', {
        method: 'POST',
        headers: { 'idempotency-key': key() },
        body: { item_id: 'pressure-washer', start_date: raceStart, end_date: raceEnd },
      }),
    ),
  );
  const winners = raceResults.filter((result) => result.status === 201);
  const losers = raceResults.filter((result) => result.status === 409);
  check('three winners for three units', winners.length === 3, raceResults.map((r) => [r.status, r.json.error?.code ?? r.json.units_free]));
  check('losers get no_unit_free', losers.every((result) => result.json.error.code === 'no_unit_free'), losers.map((r) => r.json));
  const freeCounts = winners.map((result) => result.json.units_free).sort((a, b) => b - a);
  check('free counts step down to zero', JSON.stringify(freeCounts) === JSON.stringify([2, 1, 0]), freeCounts);
  const laneIndexes = winners.map((result) => result.json.hold.unit.lane_index).sort();
  check('distinct lanes', JSON.stringify(laneIndexes) === JSON.stringify([0, 1, 2]), laneIndexes);
  const afterRace = (await call(mina, `/api/items/pressure-washer/lanes?start=${raceStart}&end=${raceEnd}`)).json;
  check('lanes agree after race', afterRace.units_free === 0, afterRace.units_free);

  for (const winner of winners) {
    await call(racers[0], `/api/holds/${winner.json.hold.id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
  }
  for (const winner of winners) {
    await call(dev, `/api/holds/${winner.json.hold.id}/cancel`, { method: 'POST', body: {} });
  }

  // ---- Borrowing limit under simultaneous requests. ----
  const tobi = await signIn('tobi@members.example');
  const limitResults = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(() =>
      call(tobi, '/api/holds', {
        method: 'POST',
        headers: { 'idempotency-key': key() },
        body: { item_id: 'drill-driver', start_date: openDates[5], end_date: openDates[6] },
      }),
    ),
  );
  const created = limitResults.filter((result) => result.status === 201);
  check('limit caps simultaneous holds at four', created.length === 4, limitResults.map((r) => [r.status, r.json.error?.code]));
  check('extra holds hit the limit or unit shortage', limitResults.filter((r) => r.status === 409).every((r) => ['borrowing_limit', 'no_unit_free'].includes(r.json.error.code)), limitResults.map((r) => r.json.error?.code));
  const fifth = await call(tobi, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'hedge-trimmer', start_date: openDates[5], end_date: openDates[6] },
  });
  check('fifth hold refused', fifth.json.error?.code === 'borrowing_limit', fifth.json);
  await call(tobi, `/api/holds/${created[0].json.hold.id}/cancel`, { method: 'POST', body: {} });
  const afterCancel = await call(tobi, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'hedge-trimmer', start_date: openDates[5], end_date: openDates[6] },
  });
  check('slot frees on cancel', afterCancel.status === 201, afterCancel.json);
  for (const hold of [...created.slice(1), afterCancel]) {
    await call(tobi, `/api/holds/${hold.json.hold.id}/cancel`, { method: 'POST', body: {} });
  }

  // ---- Racing checkouts of one ready hold. ----
  const hal = await signIn('hal@members.example');
  const raceHold = await call(hal, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'carpet-cleaner', start_date: openDates[1], end_date: openDates[2] },
  });
  check('hold for checkout race', raceHold.status === 201, raceHold.json);
  await call(dev, `/api/holds/${raceHold.json.hold.id}/ready`, { method: 'POST', body: {} });
  const ines = await signIn('ines@commonshed.example');
  const checkouts = await Promise.all(
    [dev, ines, dev].map((cookie) =>
      call(cookie, '/api/loans', {
        method: 'POST',
        headers: { 'idempotency-key': key() },
        body: { hold_id: raceHold.json.hold.id },
      }),
    ),
  );
  check('one checkout wins', checkouts.filter((result) => result.status === 201).length === 1, checkouts.map((r) => [r.status, r.json.error?.code]));
  check('losers see the collected hold', checkouts.filter((r) => r.status === 409).every((r) => r.json.error.message === "This hold is collected and can't do that."), checkouts.map((r) => r.json.error?.message));
  const raceLoanId = checkouts.find((result) => result.status === 201).json.loan.id;
  const raceLedger = (await call(rosa, `/api/ledger?loan_id=${raceLoanId}`)).json;
  check('one deposit hold entry', raceLedger.entries.filter((entry) => entry.kind === 'deposit_hold').length === 1, raceLedger.entries);

  // ---- One check-in, one inspection. ----
  const returns = await Promise.all(
    [dev, ines, dev].map((cookie) => call(cookie, `/api/loans/${raceLoanId}/return`, { method: 'POST', body: {} })),
  );
  check('one check-in wins', returns.filter((result) => result.status === 200).length === 1, returns.map((r) => [r.status, r.json.error?.code]));
  check('check-in losers see returned', returns.filter((r) => r.status === 409).every((r) => r.json.error.message === "This loan is returned and can't do that."), returns.map((r) => r.json.error?.message));
  const inspections = await Promise.all(
    [dev, ines].map((cookie) => call(cookie, `/api/loans/${raceLoanId}/inspection`, { method: 'POST', body: { outcome: 'ok', note: '' } })),
  );
  check('one inspection wins', inspections.filter((result) => result.status === 200).length === 1, inspections.map((r) => [r.status, r.json.error?.code]));

  // ---- Damage beyond the deposit. ----
  const sanderLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-wren', unit_id: 'floor-sander-1', due_date: openDates[1] },
  });
  check('sander lent', sanderLoan.status === 201, sanderLoan.json);
  await call(dev, `/api/loans/${sanderLoan.json.loan.id}/return`, { method: 'POST', body: {} });
  await call(dev, `/api/loans/${sanderLoan.json.loan.id}/inspection`, { method: 'POST', body: { outcome: 'damaged', note: 'Drum ruined.' } });
  const beyond = await call(rosa, `/api/loans/${sanderLoan.json.loan.id}/settlement`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { damage_cents: 12000 },
  });
  check('damage beyond deposit', beyond.status === 201, beyond.json);
  const split = beyond.json.settlement;
  check('released zero', split?.released_cents === 0, split);
  check('kept whole deposit', split?.damage_from_deposit_cents === 7500, split);
  check('extra billed once', split?.extra_damage_cents === 4500, split);
  check('split adds up', split.released_cents + split.damage_from_deposit_cents === split.deposit_cents);
  const beyondLedger = (await call(rosa, `/api/ledger?loan_id=${sanderLoan.json.loan.id}`)).json;
  const net = beyondLedger.entries
    .filter((entry) => ['deposit_hold', 'deposit_release', 'damage_charge'].includes(entry.kind))
    .reduce((sum, entry) => sum + entry.amount_cents, 0);
  check('deposit entries net to zero', net === 0, beyondLedger.entries);
  check('extra damage entry', beyondLedger.entries.some((entry) => entry.kind === 'extra_damage' && entry.amount_cents === 4500), beyondLedger.entries);

  // ---- Settlement mismatch and simultaneous settlements. ----
  const mismatch = await call(rosa, `/api/loans/${sanderLoan.json.loan.id}/settlement`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { damage_cents: 100 },
  });
  check('settled loan refuses another settle', mismatch.json.error?.code === 'invalid_transition', mismatch.json);

  const concurrentLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-wren', unit_id: 'floor-sander-2', due_date: openDates[1] },
  });
  await call(dev, `/api/loans/${concurrentLoan.json.loan.id}/return`, { method: 'POST', body: {} });
  await call(dev, `/api/loans/${concurrentLoan.json.loan.id}/inspection`, { method: 'POST', body: { outcome: 'ok', note: '' } });
  const settlements = await Promise.all(
    [key(), key(), key()].map((idempotencyKey) =>
      call(rosa, `/api/loans/${concurrentLoan.json.loan.id}/settlement`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: { damage_cents: 0 },
      }),
    ),
  );
  check('one settlement wins', settlements.filter((result) => result.status === 201).length === 1, settlements.map((r) => [r.status, r.json.error?.code]));
  const settledLedger = (await call(rosa, `/api/ledger?loan_id=${concurrentLoan.json.loan.id}`)).json;
  check('one release entry', settledLedger.entries.filter((entry) => entry.kind === 'deposit_release').length === 1, settledLedger.entries);

  // ---- Photo cap under simultaneous uploads. ----
  const photoLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-juno', unit_id: 'ext-ladder-1', due_date: openDates[1] },
  });
  check('ladder lent without billing', photoLoan.status === 201, photoLoan.json);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);
  const uploads = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(() => {
      const form = new FormData();
      form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
      return call(dev, `/api/loans/${photoLoan.json.loan.id}/photos`, { method: 'POST', form });
    }),
  );
  check('four photos stored', uploads.filter((result) => result.status === 201).length === 4, uploads.map((r) => [r.status, r.json.error?.code]));
  check('extra uploads hit the cap', uploads.filter((r) => r.status === 409).every((r) => r.json.error.code === 'photo_limit'), uploads.map((r) => r.json.error?.code));
  const photoLoanRead = (await call(dev, `/api/loans/${photoLoan.json.loan.id}`)).json.loan;
  check('loan lists four photos', photoLoanRead.photos.length === 4, photoLoanRead.photos.length);
  check('photo stages are checkout', photoLoanRead.photos.every((photo) => photo.stage === 'checkout'));

  // ---- Renewal. ----
  const renewLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-wren', unit_id: 'laser-level-1', due_date: openDates[1] },
  });
  check('loan to renew', renewLoan.status === 201, renewLoan.json);
  const wren = await signIn('wren@members.example');
  const renewed = await call(wren, `/api/loans/${renewLoan.json.loan.id}/renewal`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { due_date: openDates[3] },
  });
  check('renewed once', renewed.status === 200 && renewed.json.loan.renewed_at !== null, renewed.json);
  check('renewal moved the due date', renewed.json.loan?.due_date === openDates[3], renewed.json.loan?.due_date);
  const renewedAgain = await call(wren, `/api/loans/${renewLoan.json.loan.id}/renewal`, {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { due_date: openDates[4] },
  });
  check('second renewal refused', renewedAgain.json.error?.code === 'renewal_used', renewedAgain.json);
  const renewalLedger = (await call(rosa, `/api/ledger?loan_id=${renewLoan.json.loan.id}`)).json;
  check(
    'renewal writes no ledger entry beyond the deposit hold',
    renewalLedger.entries.length === 1 && renewalLedger.entries[0].kind === 'deposit_hold',
    renewalLedger.entries,
  );

  // ---- A renewal racing a hold claim for the extension days has one winner. ----
  const raceUnitLoan = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-mina', unit_id: 'post-hole-digger-1', due_date: openDates[1] },
  });
  check('loan for the renewal race', raceUnitLoan.status === 201, raceUnitLoan.json);
  const extensionDay = openDates[2];
  const [renewalAttempt, holdAttempt] = await Promise.all([
    call(dev, `/api/loans/${raceUnitLoan.json.loan.id}/renewal`, {
      method: 'POST',
      headers: { 'idempotency-key': key() },
      body: { due_date: extensionDay },
    }),
    call(hal, '/api/holds', {
      method: 'POST',
      headers: { 'idempotency-key': key() },
      body: { item_id: 'post-hole-digger', start_date: extensionDay, end_date: extensionDay },
    }),
  ]);
  check(
    'exactly one of the renewal and the hold wins',
    [renewalAttempt, holdAttempt].filter((answer) => answer.status < 300).length === 1,
    [renewalAttempt, holdAttempt].map((a) => [a.status, a.json.error?.code]),
  );
  check(
    'the loser gives the stated conflict',
    renewalAttempt.status < 300
      ? holdAttempt.json.error.code === 'no_unit_free'
      : renewalAttempt.json.error.code === 'unit_busy',
    [renewalAttempt.json.error?.code, holdAttempt.json.error?.code],
  );

  // ---- Paging stability. ----
  const juno = await signIn('juno@members.example');
  const firstPage = await call(juno, '/api/loans?limit=3');
  check('page size honoured', firstPage.json.loans.length <= 3, firstPage.json.loans.length);
  check('page size rejected', (await call(juno, '/api/loans?limit=51')).json.error.code === 'validation');
  check('bad cursor rejected', (await call(juno, '/api/loans?cursor=nonsense')).json.error.fields.cursor !== undefined);
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const page = await call(juno, `/api/loans?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    for (const loan of page.json.loans) {
      check(`loan ${loan.id} listed once`, !seen.has(loan.id));
      seen.add(loan.id);
      check('member sees only own loans', loan.member.id === 'mem-juno', loan.member);
    }
    cursor = page.json.next_cursor;
    pages += 1;
    if (pages === 1) {
      await call(dev, '/api/loans', {
        method: 'POST',
        headers: { 'idempotency-key': key() },
        body: { member_id: 'mem-juno', unit_id: 'hedge-trimmer-2', due_date: openDates[1] },
      });
    }
  } while (cursor !== null && pages < 20);
  check('paging terminates', cursor === null, pages);

  const staffCursor = (await call(dev, '/api/loans?limit=1')).json.next_cursor;
  const borrowed = await call(juno, `/api/loans?limit=5&cursor=${encodeURIComponent(staffCursor)}`);
  check("staff cursor still filters to the caller's own", borrowed.json.loans.every((loan) => loan.member.id === 'mem-juno'), borrowed.json.loans.map((l) => l.member.id));

  // ---- Not found for records the caller may not see. ----
  const otherLoan = (await call(dev, '/api/loans?limit=50')).json.loans.find((loan) => loan.member.id !== 'mem-juno');
  check("another member's loan is not found", (await call(juno, `/api/loans/${otherLoan.id}`)).status === 404);
  check('an unknown id is not found', (await call(juno, '/api/loans/4f1a0000-0000-4000-8000-000000000000')).status === 404);
  check('a malformed id is not found', (await call(juno, '/api/loans/nope')).status === 404);
  check("another member's receipt is not found", (await call(juno, `/api/loans/${otherLoan.id}/receipt`)).status === 404);

  // ---- Closure dates are never open days. ----
  const closureHold = await call(juno, '/api/holds', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { item_id: 'tile-saw', start_date: '2026-11-26', end_date: '2026-11-27' },
  });
  check('closure date refused as pickup', closureHold.status === 422 && closureHold.json.error.fields.start_date !== undefined, closureHold.json);
  const mondayWalkIn = await call(dev, '/api/loans', {
    method: 'POST',
    headers: { 'idempotency-key': key() },
    body: { member_id: 'mem-juno', unit_id: 'tile-saw-1', due_date: '2026-11-02' },
  });
  check('closed Monday refused as due date', mondayWalkIn.json.error?.fields?.due_date !== undefined, mondayWalkIn.json);

  console.log(failures === 0 ? '\nAll verification checks passed.' : `\n${failures} checks failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
