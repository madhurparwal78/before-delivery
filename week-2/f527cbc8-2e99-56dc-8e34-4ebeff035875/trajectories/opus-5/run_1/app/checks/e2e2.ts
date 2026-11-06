/* Working a barn day: visits, photos, marks, closes, invoices and the month's money. */
import sharp from 'sharp';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';

interface Session {
  cookie: string;
  user: { id: string; name: string; role: string };
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

async function call(
  method: string,
  path: string,
  options: {
    session?: Session;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: Buffer;
    contentType?: string;
    bearer?: string;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { origin: BASE, ...(options.headers ?? {}) };
  if (options.session !== undefined) headers.cookie = options.session.cookie;
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`;
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
    payload = options.raw as unknown as BodyInit;
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

const key = (): string => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;

async function hoofJpeg(width = 1200, height = 900): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: { r: 150, g: 130, b: 100 } },
  })
    .jpeg()
    .toBuffer();
}

function multipart(fields: Record<string, string>, file: { name: string; bytes: Buffer }): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----clinchlinetest';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function main(): Promise<void> {
  const farrier = await signIn('farrier@clinchline.test');
  const apprentice = await signIn('apprentice@clinchline.test');
  const ada = await signIn('owner.ada@clinchline.test');
  const bram = await signIn('owner.bram@clinchline.test');
  const dev = await signIn('owner.dev@clinchline.test');

  const practice = await call('GET', '/api/practice', { session: farrier });
  const today = practice.body.today as string;
  const barns = await call('GET', '/api/barns', { session: farrier });
  const cedar = barns.body.find((barn: any) => barn.name === 'Cedar Hollow Stables');

  console.log('\n== a day for today, published and started ==');
  const created = await call('POST', '/api/barn-days', {
    session: farrier,
    body: { barn_id: cedar.id, business_date: today, start_time: '23:30', slot_count: 4, slot_minutes: 30 },
  });
  check('draft day created', created.status === 201 && created.body.status === 'draft', created.body);
  const dayId = created.body.id as string;
  check('trip fee defaults to the barn fee', created.body.trip_fee_cents === 4500);

  const startDraft = await call('POST', `/api/barn-days/${dayId}/start`, { session: farrier });
  check('starting a draft answers illegal_transition',
    startDraft.status === 409 && startDraft.body.error === 'illegal_transition' && startDraft.body.from === 'draft',
    startDraft.body);

  const published = await call('POST', `/api/barn-days/${dayId}/publish`, { session: farrier });
  check('day published', published.status === 200 && published.body.status === 'published');
  const republish = await call('POST', `/api/barn-days/${dayId}/publish`, { session: farrier });
  check('publishing twice answers illegal_transition with from published',
    republish.status === 409 && republish.body.from === 'published', republish.body);

  const horses = await call('GET', '/api/horses', { session: farrier });
  const byName = new Map<string, any>(horses.body.map((horse: any) => [horse.name, horse]));
  const slots = published.body.slots;

  const booked: { horse: any; session: Session; booking: any }[] = [];
  const plan = [
    { name: 'Pilot', session: ada },
    { name: 'Saffron', session: bram },
    { name: 'Fern', session: dev },
  ];
  for (let index = 0; index < plan.length; index += 1) {
    const entry = plan[index] as { name: string; session: Session };
    const horse = byName.get(entry.name);
    const hold = await call('POST', `/api/barn-days/${dayId}/bookings`, {
      session: entry.session,
      body: { slot_id: slots[index].id, horse_id: horse.id, card_token: 'tok_approve_4242' },
    });
    check(`hold for ${entry.name}`, hold.status === 201, hold.body);
    const confirmed = await call('POST', `/api/bookings/${hold.body.id}/confirm`, { session: entry.session });
    check(`confirm for ${entry.name}`, confirmed.status === 200, confirmed.body);
    booked.push({ horse, session: entry.session, booking: confirmed.body });
  }

  const beforeStart = await call('GET', `/api/barn-days/${dayId}/allocation`, { session: farrier });
  check('allocation before the start answers not_started',
    beforeStart.status === 409 && beforeStart.body.error === 'not_started', beforeStart.body);

  const started = await call('POST', `/api/barn-days/${dayId}/start`, { session: farrier });
  check('day started', started.status === 200 && started.body.status === 'in_progress', started.body);
  const startAgain = await call('POST', `/api/barn-days/${dayId}/start`, { session: farrier });
  check('a second start answers illegal_transition from in_progress',
    startAgain.status === 409 && startAgain.body.from === 'in_progress', startAgain.body);

  const allocation = await call('GET', `/api/barn-days/${dayId}/allocation`, { session: farrier });
  const shares = allocation.body.shares.map((share: any) => share.share_cents);
  check('three horses count toward the trip fee', shares.length === 3, allocation.body);
  check('4500 over 3 gives 1500 each', shares.join(',') === '1500,1500,1500', shares);
  check('shares add up to the fee',
    shares.reduce((sum: number, value: number) => sum + value, 0) === 4500);

  console.log('\n== photos, marks and versions ==');
  const pilot = booked[0] as { horse: any; session: Session; booking: any };
  const visit = await call('POST', `/api/bookings/${pilot.booking.id}/visit`, { session: farrier });
  check('visit opens', visit.status === 201 && visit.body.status === 'open', visit.body);
  const visitId = visit.body.id as string;

  const rows = await call('GET', `/api/barn-days/${dayId}/bookings`, { session: farrier });
  const pilotRow = rows.body.find((row: any) => row.horse_name === 'Pilot');
  check('the booking became worked', pilotRow.status === 'worked', pilotRow);

  const closeNoPhoto = await call('POST', `/api/visits/${visitId}/close`, {
    session: farrier,
    headers: { 'idempotency-key': key() },
    body: { work: ['trim'] },
  });
  check('closing without an after photo answers photos_required',
    closeNoPhoto.status === 409 && closeNoPhoto.body.error === 'photos_required', closeNoPhoto.body);

  const notAnImage = multipart({ hoof: 'LF', phase: 'after' }, { name: 'x.svg', bytes: Buffer.from('<svg/>') });
  const refusedImage = await call('POST', `/api/visits/${visitId}/photos`, {
    session: apprentice,
    raw: notAnImage.body,
    contentType: notAnImage.contentType,
  });
  check('an SVG answers unsupported_image',
    refusedImage.status === 415 && refusedImage.body.error === 'unsupported_image', refusedImage.body);

  const jpeg = await hoofJpeg();
  const upload = multipart({ hoof: 'LF', phase: 'after' }, { name: 'lf.jpg', bytes: jpeg });
  const stored = await call('POST', `/api/visits/${visitId}/photos`, {
    session: apprentice,
    raw: upload.body,
    contentType: upload.contentType,
  });
  check('the apprentice may upload a photo', stored.status === 201, stored.body);
  check('the stored photo keeps its pixel size',
    stored.body.width === 1200 && stored.body.height === 900, stored.body);
  check('a signed path is issued', typeof stored.body.url === 'string' && stored.body.url.startsWith('/media/'));

  const again = await call('POST', `/api/visits/${visitId}/photos`, {
    session: apprentice,
    raw: upload.body,
    contentType: upload.contentType,
  });
  check('a second photo for one hoof and phase answers photo_exists',
    again.status === 409 && again.body.error === 'photo_exists', again.body);

  const fetched = await fetch(`${BASE}${stored.body.url}`);
  check('the signed path serves the image', fetched.status === 200 && fetched.headers.get('content-type') === 'image/jpeg',
    fetched.status);
  const tampered = await fetch(`${BASE}${stored.body.url.replace(/sig=.{8}/, 'sig=00000000')}`);
  check('an altered signature answers url_invalid', tampered.status === 403, tampered.status);

  const outOfBounds = await call('PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
    session: farrier,
    body: { version: null, hoof_wall: { x1: 100, y1: 100, x2: 5000, y2: 300 }, pastern: { x1: 1, y1: 1, x2: 2, y2: 2 } },
  });
  check('a point outside the photo answers 422 with the coordinates copy',
    outOfBounds.status === 422 &&
      outOfBounds.body.errors.hoof_wall === 'Keep both points inside the photo and apart from each other.',
    outOfBounds.body);

  const marks = await call('PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
    session: farrier,
    body: {
      version: null,
      hoof_wall: { x1: 300, y1: 800, x2: 700, y2: 297 },
      pastern: { x1: 700, y1: 700, x2: 1100, y2: 107 },
    },
  });
  check('marks save at version 1', marks.status === 200 && marks.body.version === 1, marks.body);
  check('the hoof wall angle is 51.5', marks.body.hoof_wall.angle === 51.5, marks.body.hoof_wall);
  check('the pastern angle is 56.0', marks.body.pastern.angle === 56, marks.body.pastern);
  check('the label is broken-back', marks.body.alignment === 'broken-back');
  check('the save is attributed', marks.body.saved_by.name === 'Marlow Tesk', marks.body.saved_by);

  const stale = await call('PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
    session: apprentice,
    body: {
      version: null,
      hoof_wall: { x1: 10, y1: 10, x2: 20, y2: 20 },
      pastern: { x1: 30, y1: 30, x2: 40, y2: 40 },
    },
  });
  check('a save over a newer version answers 412 stale_marks',
    stale.status === 412 && stale.body.error === 'stale_marks', stale.body);
  check('the 412 carries the stored marks', stale.body.current?.version === 1, stale.body.current);

  const second = await call('PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
    session: apprentice,
    body: {
      version: 1,
      hoof_wall: { x1: 300, y1: 820, x2: 700, y2: 269 },
      pastern: { x1: 700, y1: 700, x2: 1100, y2: 129 },
    },
  });
  check('the apprentice saves version 2', second.status === 200 && second.body.version === 2, second.body);
  check('version 2 reads aligned', second.body.alignment === 'aligned' && second.body.hoof_wall.angle === 54);

  const history = await call('GET', `/api/visits/${visitId}/hooves/LF/marks/history`, { session: farrier });
  check('the history holds both versions, attributed',
    history.body.length === 2 && history.body[0].saved_by.role === 'farrier' &&
      history.body[1].saved_by.role === 'apprentice',
    history.body.map((entry: any) => entry.saved_by.role));

  const restored = await call('POST', `/api/visits/${visitId}/hooves/LF/marks/restore`, {
    session: farrier,
    body: { version: 2, restore_version: 1 },
  });
  check('restoring makes version 3 from version 1',
    restored.status === 200 && restored.body.version === 3 && restored.body.restored_from === 1, restored.body);
  check('the restore copies the stored angles', restored.body.hoof_wall.angle === 51.5);

  const badRestore = await call('POST', `/api/visits/${visitId}/hooves/LF/marks/restore`, {
    session: farrier,
    body: { version: 3, restore_version: 99 },
  });
  check('an unknown restore version answers 422',
    badRestore.status === 422 && badRestore.body.errors.restore_version === "That version is not in this hoof's history.",
    badRestore.body);

  console.log('\n== apprentice limits ==');
  const apprenticeClose = await call('POST', `/api/visits/${visitId}/close`, {
    session: apprentice,
    headers: { 'idempotency-key': key() },
    body: { work: ['trim'] },
  });
  check('the apprentice may not close a visit', apprenticeClose.status === 403, apprenticeClose.body);
  const apprenticePrices = await call('GET', '/api/price-lists', { session: apprentice });
  check('the apprentice may not read prices', apprenticePrices.status === 403);
  const apprenticeStart = await call('POST', `/api/barn-days/${dayId}/close`, { session: apprentice });
  check('the apprentice may not move a day', apprenticeStart.status === 403);
  const apprenticeVisit = await call('GET', `/api/visits/${visitId}`, { session: apprentice });
  check('the apprentice reads a visit with no invoice data', apprenticeVisit.body.invoice === null);

  console.log('\n== closing a visit into one invoice ==');
  const closeKey = key();
  const closed = await call('POST', `/api/visits/${visitId}/close`, {
    session: farrier,
    headers: { 'idempotency-key': closeKey },
    body: { work: ['trim'], note: 'Short toe, good wall.' },
  });
  check('the visit closes and is invoiced',
    closed.status === 200 && closed.body.status === 'invoiced', closed.body);
  const invoice = closed.body.invoice;
  check('the invoice holds the trim, the trip share and the deposit credit',
    invoice.items.length === 3 &&
      invoice.items[0].amount_cents === 5500 &&
      invoice.items[1].amount_cents === 1500 &&
      invoice.items[2].amount_cents === -2500,
    invoice.items);
  check('the total is 4500 after the deposit credit', invoice.total_cents === 4500, invoice);
  check('the invoice is unpaid with the same balance',
    invoice.status === 'unpaid' && invoice.balance_cents === 4500, invoice);
  check('the trip item names the barn and date',
    invoice.items[1].description === `Trip share — Cedar Hollow Stables ${today}`, invoice.items[1]);
  check('it reached Kill Bill', typeof invoice.killbill_invoice_id === 'string', invoice.killbill_invoice_id);

  const replay = await call('POST', `/api/visits/${visitId}/close`, {
    session: farrier,
    headers: { 'idempotency-key': closeKey },
    body: { work: ['trim'], note: 'Short toe, good wall.' },
  });
  check('replaying the close repeats the stored answer',
    replay.status === 200 && replay.body.invoice.id === invoice.id, replay.body.invoice?.id);

  const conflictBody = await call('POST', `/api/visits/${visitId}/close`, {
    session: farrier,
    headers: { 'idempotency-key': closeKey },
    body: { work: ['full_reset'] },
  });
  check('the same key with another body answers idempotency_conflict',
    conflictBody.status === 409 && conflictBody.body.error === 'idempotency_conflict', conflictBody.body);

  const freshKey = await call('POST', `/api/visits/${visitId}/close`, {
    session: farrier,
    headers: { 'idempotency-key': key() },
    body: { work: ['trim'] },
  });
  check('a new key on a closed visit answers illegal_transition',
    freshKey.status === 409 && freshKey.body.error === 'illegal_transition', freshKey.body);

  const invoices = await call('GET', '/api/invoices', { session: ada });
  check('the owner sees exactly her one invoice', invoices.body.length === 1 && invoices.body[0].id === invoice.id,
    invoices.body.length);
  const otherInvoices = await call('GET', '/api/invoices', { session: bram });
  check('another owner sees none of it', otherInvoices.body.every((row: any) => row.id !== invoice.id));

  const readBack = await call('GET', `/api/invoices/${invoice.id}/reconciliation`, { session: farrier });
  check('the read-back matches Kill Bill to the cent',
    readBack.body.status === 'matched' && readBack.body.killbill.balance === 4500, readBack.body);

  console.log('\n== excusing a horse moves its share ==');
  const saffronBooking = (booked[1] as { booking: any }).booking;
  const excused = await call('POST', `/api/bookings/${saffronBooking.id}/excuse`, { session: farrier });
  check('the horse is excused', excused.status === 200 && excused.body.booking.status === 'excused', excused.body);
  const afterExcuse = excused.body.allocation;
  const excusedShare = afterExcuse.shares.find((share: any) => share.booking_id === saffronBooking.id);
  check('the excused share becomes 0', excusedShare.share_cents === 0, excusedShare);
  check('the billed share is untouched',
    afterExcuse.shares.find((s: any) => s.horse.name === 'Pilot').share_cents === 1500);
  check('the pool moves to the horse not yet billed',
    afterExcuse.shares.find((s: any) => s.horse.name === 'Fern').share_cents === 3000, afterExcuse.shares);
  check('the shares still add up to the fee',
    afterExcuse.shares.reduce((sum: number, s: any) => sum + s.share_cents, 0) === 4500);
  check('one adjustment per changed share, in booking order',
    afterExcuse.adjustments.length === 2 &&
      afterExcuse.adjustments[0].delta_cents === -1500 &&
      afterExcuse.adjustments[1].delta_cents === 1500,
    afterExcuse.adjustments);
  check('adjustments are numbered from 1',
    afterExcuse.adjustments[0].seq === 1 && afterExcuse.adjustments[1].seq === 2);

  const excuseAgain = await call('POST', `/api/bookings/${saffronBooking.id}/excuse`, { session: farrier });
  check('excusing twice answers illegal_transition',
    excuseAgain.status === 409 && excuseAgain.body.from === 'excused', excuseAgain.body);

  console.log('\n== no-show, close the day and the trip-only invoice ==');
  const fernBooking = (booked[2] as { booking: any }).booking;
  const closeEarly = await call('POST', `/api/barn-days/${dayId}/close`, { session: farrier });
  check('closing with an open horse answers unresolved_bookings',
    closeEarly.status === 409 && closeEarly.body.error === 'unresolved_bookings', closeEarly.body);

  const noShow = await call('POST', `/api/bookings/${fernBooking.id}/no-show`, { session: farrier });
  check('the horse is marked no-show', noShow.status === 200 && noShow.body.status === 'no_show', noShow.body);

  const dayClosed = await call('POST', `/api/barn-days/${dayId}/close`, { session: farrier });
  check('the day closes', dayClosed.status === 200 && dayClosed.body.status === 'closed', dayClosed.body);

  const allInvoices = await call('GET', '/api/invoices', { session: farrier });
  const tripOnly = allInvoices.body.filter((row: any) => row.kind === 'trip');
  check('exactly one trip-only invoice exists', tripOnly.length === 1, tripOnly);
  check('it is the no-show horse', tripOnly[0].horse.name === 'Fern', tripOnly[0]);
  check('its first item names the no-show',
    tripOnly[0].items[0].description === `Trip share — Cedar Hollow Stables ${today} (Fern, no-show)`,
    tripOnly[0].items[0]);
  check('the kept deposit is credited up to the share',
    tripOnly[0].items[1].amount_cents === -2500 && tripOnly[0].total_cents === 500, tripOnly[0]);

  console.log('\n== an owner pays ==');
  const payKey = key();
  const paid = await call('POST', `/api/invoices/${invoice.id}/payments`, {
    session: ada,
    headers: { 'idempotency-key': payKey },
    body: { card_token: 'tok_approve_4242' },
  });
  check('the payment answers 201 paid', paid.status === 201 && paid.body.status === 'paid', paid.body);
  check('the balance is zero', paid.body.balance_cents === 0);
  const payAgain = await call('POST', `/api/invoices/${invoice.id}/payments`, {
    session: ada,
    headers: { 'idempotency-key': key() },
    body: { card_token: 'tok_approve_4242' },
  });
  check('paying again answers already_paid',
    payAgain.status === 409 && payAgain.body.error === 'already_paid', payAgain.body);

  const paidReadBack = await call('GET', `/api/invoices/${invoice.id}/reconciliation`, { session: farrier });
  check('the paid invoice still matches Kill Bill',
    paidReadBack.body.status === 'matched' && paidReadBack.body.killbill.balance === 0, paidReadBack.body);

  console.log('\n== dunning ==');
  const devInvoice = tripOnly[0];
  const declined = await call('POST', `/api/invoices/${devInvoice.id}/payments`, {
    session: dev,
    headers: { 'idempotency-key': key() },
    body: { card_token: 'tok_funds_9995' },
  });
  check('a soft decline answers 402 insufficient_funds',
    declined.status === 402 && declined.body.decline_code === 'insufficient_funds', declined.body);
  const dunned = await call('GET', '/api/invoices', { session: dev });
  check('the invoice is past due', dunned.body[0].dunning_state === 'past_due', dunned.body[0]);

  const hard = await call('POST', `/api/invoices/${devInvoice.id}/payments`, {
    session: dev,
    headers: { 'idempotency-key': key() },
    body: { card_token: 'tok_decline_0002' },
  });
  check('a hard decline answers 402 do_not_honor', hard.status === 402 && hard.body.decline_code === 'do_not_honor');
  const blocked = await call('GET', '/api/invoices', { session: dev });
  check('the invoice is blocked', blocked.body[0].dunning_state === 'blocked', blocked.body[0]);

  const maple = byName.get('Maple');
  const larkspurDays = await call('GET', '/api/barn-days', { session: farrier });
  const larkspur = larkspurDays.body.find((day: any) => day.barn.name === 'Larkspur Farm');
  await call('POST', `/api/barn-days/${larkspur.id}/publish`, { session: farrier });
  const blockedHold = await call('POST', `/api/barn-days/${larkspur.id}/bookings`, {
    session: dev,
    body: { slot_id: (await call('GET', `/api/barn-days/${larkspur.id}`, { session: dev })).body.slots[0].id, horse_id: maple.id, card_token: 'tok_approve_4242' },
  });
  check('a blocked owner cannot hold a slot',
    blockedHold.status === 409 && blockedHold.body.error === 'account_blocked', blockedHold.body);

  const cleared = await call('POST', `/api/invoices/${devInvoice.id}/payments`, {
    session: dev,
    headers: { 'idempotency-key': key() },
    body: { card_token: 'tok_approve_4242' },
  });
  check('paying clears the block', cleared.status === 201 && cleared.body.status === 'paid', cleared.body);
  check('the dunning state reads cleared', cleared.body.dunning_state === 'cleared', cleared.body);
  const unblockedHold = await call('POST', `/api/barn-days/${larkspur.id}/bookings`, {
    session: dev,
    body: { slot_id: (await call('GET', `/api/barn-days/${larkspur.id}`, { session: dev })).body.slots[0].id, horse_id: maple.id, card_token: 'tok_approve_4242' },
  });
  check('the owner can book once the block is paid off', unblockedHold.status === 201, unblockedHold.body);

  console.log('\n== the month against the ledger ==');
  const dashboard = await call('GET', '/api/dashboard', { session: farrier });
  check('the dashboard reports the month', typeof dashboard.body.month === 'string', dashboard.body.month);
  check('billed covers both invoices gross',
    dashboard.body.billed_cents === 7000 + 3000, dashboard.body);
  check('collected counts deposits and card payments, not applied credit',
    dashboard.body.collected_cents > 0, dashboard.body);
  check('daily rows are present', Array.isArray(dashboard.body.rows) && dashboard.body.rows.length > 0);
  const badMonth = await call('GET', '/api/dashboard?month=nope', { session: farrier });
  check('a malformed month answers 422 on month', badMonth.status === 422 && badMonth.body.errors.month !== undefined);

  const exported = await call('POST', '/api/dashboard/exports', {
    session: farrier,
    body: { month: dashboard.body.month },
  });
  check('the export is queued', exported.status === 202 && typeof exported.body.job_id === 'string', exported.body);
  let exportJob: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await call('GET', `/api/jobs/${exported.body.job_id}`, { session: farrier });
    if (job.body.status === 'succeeded' || job.body.status === 'dead') {
      exportJob = job.body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check('the export job succeeds', exportJob?.status === 'succeeded', exportJob);
  check('it reports a key and a signed url',
    typeof exportJob?.result?.key === 'string' && typeof exportJob?.result?.url === 'string', exportJob?.result);
  const csv = await fetch(`${BASE}${exportJob.result.url}`);
  const csvText = await csv.text();
  check('the export downloads with the published header',
    csv.status === 200 && csvText.split('\n')[0] === 'date,kind,owner,horse,amount', csvText.slice(0, 120));

  console.log('\n== vet links ==');
  const juniper = byName.get('Juniper');
  const link = await call('POST', `/api/horses/${juniper.id}/vet-links`, {
    session: farrier,
    body: { vet_name: 'Dr Wren Ash', vet_email: 'vet.wren@clinchline.test' },
  });
  check('a vet link is issued', link.status === 201 && typeof link.body.url === 'string', link.body);
  const token = (link.body.url as string).replace('/vet/', '');
  const vetRead = await fetch(`${BASE}/api/vet/${token}`);
  const vetBody = (await vetRead.json()) as any;
  check('the vet reads the comparison', vetRead.status === 200 && vetBody.horse.name === 'Juniper', vetBody);
  check('it carries no horse id or visit ids',
    vetBody.horse.id === undefined && vetBody.hooves.LF.previous.visit_id === undefined, vetBody.hooves.LF.previous);
  check('the vet readout matches the stored angles',
    vetBody.hooves.LF.readout[0] === 'Hoof wall 51.5° → 54.0° (+2.5°)', vetBody.hooves.LF.readout);
  check('hind hooves with no marks read null', vetBody.hooves.LH === null && vetBody.hooves.RH === null);

  const vetWrite = await fetch(`${BASE}/api/vet/${token}`, { method: 'POST', headers: { origin: BASE } });
  check('a write on a vet path answers read_only 405', vetWrite.status === 405, vetWrite.status);

  const views = await call('GET', `/api/vet-links/${link.body.id}/views`, { session: farrier });
  check('the view log records the read',
    views.body.length === 1 && views.body[0].outcome === 'viewed' && views.body[0].previous_date !== null,
    views.body);

  const revoked = await call('POST', `/api/vet-links/${link.body.id}/revoke`, { session: farrier });
  check('the link is revoked', revoked.status === 200 && revoked.body.status === 'revoked');
  const afterRevoke = await fetch(`${BASE}/api/vet/${token}`);
  check('the revoked token answers 404', afterRevoke.status === 404, afterRevoke.status);

  console.log('\n== scoped API tokens ==');
  const readToken = await call('POST', '/api/tokens', {
    session: farrier,
    body: { name: 'reader', scope: 'read_only' },
  });
  check('a read-only token is issued', readToken.status === 201 && readToken.body.token.startsWith('cl_'),
    readToken.body.token?.slice(0, 6));
  const tokenHorses = await call('GET', '/api/horses', { bearer: readToken.body.token });
  check('the token reads horses', tokenHorses.status === 200 && tokenHorses.body.length > 0);
  const tokenInvoices = await call('GET', '/api/invoices', { bearer: readToken.body.token });
  check('a read-only token is refused invoices',
    tokenInvoices.status === 403 && tokenInvoices.body.error === 'insufficient_scope', tokenInvoices.body);
  const tokenJobs = await call('GET', '/api/jobs', { bearer: readToken.body.token });
  check('a token is refused the job list', tokenJobs.status === 403 && tokenJobs.body.error === 'insufficient_scope');
  const billingToken = await call('POST', '/api/tokens', {
    session: farrier,
    body: { name: 'biller', scope: 'billing' },
  });
  const billingInvoices = await call('GET', '/api/invoices', { bearer: billingToken.body.token });
  check('a billing token reads invoices', billingInvoices.status === 200, billingInvoices.body);
  await call('DELETE', `/api/tokens/${readToken.body.id}`, { session: farrier });
  const afterRevokeToken = await call('GET', '/api/horses', { bearer: readToken.body.token });
  check('a revoked token answers 401', afterRevokeToken.status === 401, afterRevokeToken.body);

  console.log('\n== server boundary ==');
  const cross = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.test' },
    body: JSON.stringify({ email: 'farrier@clinchline.test', password: 'hoofcare-2026' }),
  });
  check('a cross-origin write answers cross_origin 403', cross.status === 403, cross.status);
  const big = await call('POST', '/api/barn-days', {
    session: farrier,
    raw: Buffer.from(JSON.stringify({ note: 'x'.repeat(70000) })),
    contentType: 'application/json',
  });
  check('an oversized JSON body answers payload_too_large',
    big.status === 413 && big.body.error === 'payload_too_large', big.body);
  const wrongType = await call('POST', '/api/barn-days', {
    session: farrier,
    raw: Buffer.from('barn_id=1'),
    contentType: 'text/plain',
  });
  check('a mistyped body answers unsupported_media_type',
    wrongType.status === 415 && wrongType.body.error === 'unsupported_media_type', wrongType.body);
  for (const path of ['/run.json', '/package.json', '/package-lock.json', '/src/server/index.ts', '/../etc/passwd']) {
    const served = await fetch(`${BASE}${path}`);
    check(`${path} is not served`, served.status === 404, served.status);
  }

  console.log('\n== request ids and logs ==');
  const echoed = await fetch(`${BASE}/api/me`, { headers: { 'x-request-id': 'abcdef12-test', cookie: farrier.cookie } });
  check('a valid request id is echoed', echoed.headers.get('x-request-id') === 'abcdef12-test');
  const generated = await fetch(`${BASE}/api/me`, { headers: { 'x-request-id': 'bad', cookie: farrier.cookie } });
  check('an invalid request id is replaced', (generated.headers.get('x-request-id') ?? '').length === 36);

  console.log(`\nfailures: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

await main();
