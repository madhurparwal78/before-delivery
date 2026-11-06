/* A walk through the journeys against a running server, for local checking. */
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';

interface Session {
  cookie: string;
  user: { id: string; name: string; role: string };
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

async function call(
  method: string,
  path: string,
  options: { session?: Session; body?: unknown; headers?: Record<string, string>; raw?: Buffer | string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { origin: BASE, ...(options.headers ?? {}) };
  if (options.session !== undefined) headers.cookie = options.session.cookie;
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    payload = options.raw as BodyInit;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function signIn(email: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: 'hoofcare-2026' }),
  });
  const setCookie = response.headers.getSetCookie()[0] ?? '';
  const body = (await response.json()) as { user: Session['user'] };
  return { cookie: setCookie.split(';')[0] as string, user: body.user };
}

function key(): string {
  return `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function mail(): Promise<{ Subject: string; To: { Address: string }[] }[]> {
  const response = await fetch('http://mailpit:8025/api/v1/messages?limit=200');
  const body = (await response.json()) as { messages: { Subject: string; To: { Address: string }[] }[] };
  return body.messages ?? [];
}

async function main(): Promise<void> {
  console.log('\n== sign in and roles ==');
  const anon = await call('GET', '/api/horses');
  check('signed out horses answers 401', anon.status === 401, anon.body);
  const bad = await call('POST', '/api/session', { body: { email: 'farrier@clinchline.test', password: 'wrong' } });
  check('wrong password answers invalid_credentials', bad.status === 401 && bad.body.error === 'invalid_credentials');

  const farrier = await signIn('farrier@clinchline.test');
  const apprentice = await signIn('apprentice@clinchline.test');
  const ada = await signIn('owner.ada@clinchline.test');
  const bram = await signIn('owner.bram@clinchline.test');
  const cleo = await signIn('owner.cleo@clinchline.test');
  const dev = await signIn('owner.dev@clinchline.test');
  const rosa = await signIn('manager.cedar@clinchline.test');
  check('farrier signed in', farrier.user.role === 'farrier');
  check('barn manager signed in', rosa.user.role === 'barn_manager');

  const practice = await call('GET', '/api/practice', { session: farrier });
  check('practice zone is America/Denver', practice.body.time_zone === 'America/Denver', practice.body);

  console.log('\n== seeded horses and next due ==');
  const horses = await call('GET', '/api/horses', { session: farrier });
  check('eight seeded horses', horses.body.length === 8, horses.body.length);
  const byName = new Map<string, any>(horses.body.map((horse: any) => [horse.name, horse]));
  check('Juniper is due', byName.get('Juniper').due_status === 'due', byName.get('Juniper'));
  check('Pilot is overdue', byName.get('Pilot').due_status === 'overdue');
  check('Saffron is current', byName.get('Saffron').due_status === 'current');
  check('Maple is current', byName.get('Maple').due_status === 'current');
  check('Quarry is unknown', byName.get('Quarry').due_status === 'unknown');
  check('farrier sees owner contact', byName.get('Juniper').owner.email === 'owner.ada@clinchline.test');

  const adaHorses = await call('GET', '/api/horses', { session: ada });
  check('Ada sees only her two horses',
    adaHorses.body.length === 2 && adaHorses.body.every((h: any) => ['Juniper', 'Pilot'].includes(h.name)),
    adaHorses.body.map((h: any) => h.name));
  const bramHorses = await call('GET', '/api/horses', { session: bram });
  check('Bram sees only his two horses',
    bramHorses.body.length === 2 && bramHorses.body.every((h: any) => ['Saffron', 'Quarry'].includes(h.name)));
  const managerHorses = await call('GET', '/api/horses', { session: rosa });
  check('barn manager is refused horses with 403', managerHorses.status === 403, managerHorses.body);

  console.log('\n== comparison readout from seed data ==');
  const juniper = byName.get('Juniper');
  const lf = await call('GET', `/api/horses/${juniper.id}/comparison?hoof=LF`, { session: ada });
  check('left fore readout line 1',
    lf.body.readout?.[0] === 'Hoof wall 51.5° → 54.0° (+2.5°)', lf.body.readout);
  check('left fore readout line 2', lf.body.readout?.[1] === 'Pastern 56.0° → 55.0° (−1.0°)', lf.body.readout);
  check('left fore readout line 3', lf.body.readout?.[2] === 'Alignment broken-back → aligned', lf.body.readout);
  const rf = await call('GET', `/api/horses/${juniper.id}/comparison?hoof=RF`, { session: ada });
  check('right fore readout line 1', rf.body.readout?.[0] === 'Hoof wall 49.6° → 50.8° (+1.2°)', rf.body.readout);
  check('right fore readout line 2', rf.body.readout?.[1] === 'Pastern 53.0° → 50.8° (−2.2°)', rf.body.readout);
  check('right fore readout line 3', rf.body.readout?.[2] === 'Alignment broken-back → aligned', rf.body.readout);
  const stranger = await call('GET', `/api/horses/${juniper.id}/comparison?hoof=LF`, { session: bram });
  check('another owner gets 404 for that horse', stranger.status === 404);

  console.log('\n== clock-change barn days ==');
  const barns = await call('GET', '/api/barns', { session: farrier });
  const cedar = barns.body.find((barn: any) => barn.name === 'Cedar Hollow Stables');
  const spring = await call('POST', '/api/barn-days', {
    session: farrier,
    body: { barn_id: cedar.id, business_date: '2027-03-14', start_time: '02:30', slot_count: 4, slot_minutes: 45 },
  });
  check('nonexistent start time answers 422 on start_time',
    spring.status === 422 && typeof spring.body.errors?.start_time === 'string', spring.body);
  check('nonexistent time copy names the zone',
    spring.body.errors?.start_time === 'That time does not exist on that date in America/Denver.');

  const springOk = await call('POST', '/api/barn-days', {
    session: farrier,
    body: { barn_id: cedar.id, business_date: '2027-03-14', start_time: '07:30', slot_count: 4, slot_minutes: 45 },
  });
  check('spring-forward day starts at -06:00', springOk.body.starts_at === '2027-03-14T07:30:00-06:00', springOk.body.starts_at);
  check('its cutoff is 24 elapsed hours earlier',
    springOk.body.cancellation_cutoff_at === '2027-03-13T06:30:00-07:00', springOk.body.cancellation_cutoff_at);

  const fall = await call('POST', '/api/barn-days', {
    session: farrier,
    body: { barn_id: cedar.id, business_date: '2027-11-07', start_time: '07:30', slot_count: 2, slot_minutes: 60 },
  });
  check('fall-back day cutoff reads 08:30',
    fall.body.cancellation_cutoff_at === '2027-11-06T08:30:00-06:00', fall.body.cancellation_cutoff_at);

  console.log('\n== publish, book, race and waitlist ==');
  const days = await call('GET', '/api/barn-days', { session: farrier });
  const seeded = days.body.find((day: any) => day.status === 'published' && day.slot_count === 4);
  check('seeded published day found', seeded !== undefined);
  check('seeded day shows 0 of 4', seeded.booked_count === 0 && seeded.slot_count === 4);

  const adaDays = await call('GET', '/api/barn-days', { session: ada });
  check('the owner sees the seeded day', adaDays.body.some((day: any) => day.id === seeded.id),
    adaDays.body.map((day: any) => day.id));
  check('the owner sees only bookable days at a barn where she keeps a horse',
    adaDays.body.every(
      (day: any) =>
        ['published', 'full', 'in_progress'].includes(day.status) &&
        day.barn.name === 'Cedar Hollow Stables',
    ),
    adaDays.body.map((day: any) => [day.status, day.barn.name]));
  const draftDay = days.body.find((day: any) => day.status === 'draft');
  const ownerDraft = await call('GET', `/api/barn-days/${draftDay.id}`, { session: ada });
  check('owner gets 404 on a draft day', ownerDraft.status === 404);

  const slots = seeded.slots;
  const hold1 = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
    session: ada,
    body: { slot_id: slots[0].id, horse_id: juniper.id, card_token: 'tok_approve_4242' },
  });
  check('hold answers 201 held', hold1.status === 201 && hold1.body.status === 'held', hold1.body);
  check('hold carries a booking number', typeof hold1.body.number === 'number');
  check('hold has a stored expiry', typeof hold1.body.hold_expires_at === 'string');
  check('deposit is 2500', hold1.body.deposit_cents === 2500);

  const confirm1 = await call('POST', `/api/bookings/${hold1.body.id}/confirm`, { session: ada });
  check('confirm answers 200 confirmed', confirm1.status === 200 && confirm1.body.status === 'confirmed', confirm1.body);
  const confirmAgain = await call('POST', `/api/bookings/${hold1.body.id}/confirm`, { session: ada });
  check('confirming twice is a no-op 200', confirmAgain.status === 200 && confirmAgain.body.status === 'confirmed');

  const sameHorse = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
    session: ada,
    body: { slot_id: slots[1].id, horse_id: juniper.id, card_token: 'tok_approve_4242' },
  });
  check('same horse twice answers horse_already_booked',
    sameHorse.status === 409 && sameHorse.body.error === 'horse_already_booked', sameHorse.body);

  const declined = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
    session: bram,
    body: { slot_id: slots[1].id, horse_id: bramHorses.body[0].id, card_token: 'tok_decline_0002' },
  });
  check('declined card answers 402', declined.status === 402 && declined.body.error === 'card_declined', declined.body);
  check('declined card names its code', declined.body.decline_code === 'do_not_honor');

  const cardNumber = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
    session: bram,
    body: { slot_id: slots[1].id, horse_id: bramHorses.body[0].id, card_token: '4242424242424242' },
  });
  check('a real-looking card number answers 422',
    cardNumber.status === 422 && cardNumber.body.errors?.card_token === 'Enter a test card token, never a card number.',
    cardNumber.body);

  // Fill the remaining three slots.
  const saffron = bramHorses.body.find((h: any) => h.name === 'Saffron');
  const quarry = bramHorses.body.find((h: any) => h.name === 'Quarry');
  const cleoHorses = await call('GET', '/api/horses', { session: cleo });
  const tamarack = cleoHorses.body.find((h: any) => h.name === 'Tamarack');
  const fills = [
    { session: bram, horse: saffron, slot: slots[1] },
    { session: bram, horse: quarry, slot: slots[2] },
    { session: cleo, horse: tamarack, slot: slots[3] },
  ];
  const held: any[] = [];
  for (const fill of fills) {
    const response = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
      session: fill.session,
      body: { slot_id: fill.slot.id, horse_id: fill.horse.id, card_token: 'tok_approve_4242' },
    });
    check(`hold for ${fill.horse.name}`, response.status === 201, response.body);
    held.push({ ...fill, booking: response.body });
    const confirmed = await call('POST', `/api/bookings/${response.body.id}/confirm`, { session: fill.session });
    check(`confirm for ${fill.horse.name}`, confirmed.status === 200, confirmed.body);
  }

  const full = await call('GET', `/api/barn-days/${seeded.id}`, { session: farrier });
  check('day reads full at 4 of 4', full.body.status === 'full' && full.body.booked_count === 4, full.body.status);

  const wicket = cleoHorses.body.find((h: any) => h.name === 'Wicket');
  const dayFull = await call('POST', `/api/barn-days/${seeded.id}/bookings`, {
    session: cleo,
    body: { slot_id: slots[0].id, horse_id: wicket.id, card_token: 'tok_approve_4242' },
  });
  check('a hold on a full day answers day_full', dayFull.status === 409 && dayFull.body.error === 'day_full', dayFull.body);

  const joined = await call('POST', `/api/barn-days/${seeded.id}/waitlist`, {
    session: cleo,
    body: { horse_id: wicket.id, card_token: 'tok_approve_4242' },
  });
  check('waitlist join answers 201 position 1', joined.status === 201 && joined.body.position === 1, joined.body);
  const devHorses = await call('GET', '/api/horses', { session: dev });
  const fern = devHorses.body.find((h: any) => h.name === 'Fern');
  const joined2 = await call('POST', `/api/barn-days/${seeded.id}/waitlist`, {
    session: dev,
    body: { horse_id: fern.id, card_token: 'tok_approve_4242' },
  });
  check('second waitlist join is position 2', joined2.body.position === 2, joined2.body);
  const rejoin = await call('POST', `/api/barn-days/${seeded.id}/waitlist`, {
    session: cleo,
    body: { horse_id: wicket.id, card_token: 'tok_approve_4242' },
  });
  check('joining twice answers already_on_waitlist',
    rejoin.status === 409 && rejoin.body.error === 'already_on_waitlist', rejoin.body);

  console.log('\n== role-shaped booking rows ==');
  const farrierRows = await call('GET', `/api/barn-days/${seeded.id}/bookings`, { session: farrier });
  check('farrier rows carry owner and share keys',
    Object.keys(farrierRows.body[0]).sort().join(',') ===
      'booking_id,horse_id,horse_name,invoice_status,invoice_total_cents,number,owner_email,owner_name,owner_phone,slot_time,stall,status,trip_share_cents,visit_id,visit_status',
    Object.keys(farrierRows.body[0]).sort());
  const apprenticeRows = await call('GET', `/api/barn-days/${seeded.id}/bookings`, { session: apprentice });
  check('apprentice rows carry no owner or share',
    Object.keys(apprenticeRows.body[0]).sort().join(',') ===
      'booking_id,horse_id,horse_name,slot_time,stall,status,visit_id,visit_status',
    Object.keys(apprenticeRows.body[0]).sort());
  const managerRows = await call('GET', `/api/barn-days/${seeded.id}/bookings`, { session: rosa });
  check('barn manager rows carry only time, horse and stall',
    Object.keys(managerRows.body[0]).sort().join(',') === 'horse_name,slot_time,stall',
    Object.keys(managerRows.body[0]).sort());
  const ownerRows = await call('GET', `/api/barn-days/${seeded.id}/bookings`, { session: ada });
  check('owner is refused the booking list', ownerRows.status === 403);

  console.log('\n== cancellation in the practice zone ==');
  const preview = await call('GET', `/api/bookings/${held[2].booking.id}/cancellation-preview`, { session: cleo });
  check('preview says not late', preview.body.late === false, preview.body);
  check('preview promises a refund', preview.body.deposit_outcome === 'refund' && preview.body.deposit_cents === 2500);

  const cancelled = await call('POST', `/api/bookings/${held[2].booking.id}/cancel`, { session: cleo });
  check('cancel in time answers cancelled_in_time',
    cancelled.status === 200 && cancelled.body.booking.status === 'cancelled_in_time', cancelled.body);
  check('no trip share applies', cancelled.body.trip_share_applies === false);
  check('the deposit is refunded in full', cancelled.body.deposit_outcome === 'refund' && cancelled.body.refunded_cents === 2500);
  check('one decision instant is reported', typeof cancelled.body.decided_at === 'string');

  // The offer pass ran in the same transaction, so position 1 already holds the slot.
  const afterCancel = await call('GET', `/api/barn-days/${seeded.id}/waitlist`, { session: farrier });
  check('waitlist closed up to one entry', afterCancel.body.length === 1 && afterCancel.body[0].position === 1,
    afterCancel.body);
  const cleoBookings = await call('GET', '/api/my/bookings', { session: cleo });
  const offered = cleoBookings.body.find((booking: any) => booking.offer === true);
  check('position 1 holds the freed slot as an offer', offered !== undefined, cleoBookings.body);
  check('the offer is held with an expiry', offered?.status === 'held' && typeof offered.hold_expires_at === 'string');

  const confirmOffer = await call('POST', `/api/bookings/${offered.id}/confirm`, { session: cleo });
  check('the offer confirms', confirmOffer.status === 200 && confirmOffer.body.status === 'confirmed', confirmOffer.body);

  console.log('\n== refused claims leave no trace ==');
  const numbers = (await call('GET', '/api/audit?entity_type=booking&limit=500', { session: farrier })).body;
  check('audit holds booking entries', Array.isArray(numbers) && numbers.length > 0);
  const payments = await call('GET', '/api/payments', { session: farrier });
  const declinedRows = payments.body.filter((payment: any) => payment.status === 'declined');
  check('exactly one declined payment row exists', declinedRows.length === 1, declinedRows.length);
  check('no booking is attached to the declined row', declinedRows[0].booking_id === null);

  console.log('\n== start the day and fix the shares ==');
  const tooEarly = await call('POST', `/api/barn-days/${seeded.id}/start`, { session: farrier });
  check('starting a future day answers too_early', tooEarly.status === 409 && tooEarly.body.error === 'too_early',
    tooEarly.body);

  console.log(`\nfailures: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

await main();
