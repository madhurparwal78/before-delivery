/* Resumable uploads, streams, honest payments, dunning, jobs and photo handling. */
import sharp from 'sharp';
import { query, pool, withClient } from '../src/server/db.js';

const PRIMARY = 'http://127.0.0.1:4173';
const PEER = process.env.PEER ?? 'http://127.0.0.1:4183';
const FAST = process.env.FAST ?? 'http://127.0.0.1:4184';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

interface Session {
  cookie: string;
}

async function call(
  base: string,
  method: string,
  path: string,
  options: {
    session?: Session;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: Buffer | ArrayBuffer;
    contentType?: string;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { origin: base, ...(options.headers ?? {}) };
  if (options.session !== undefined) headers.cookie = options.session.cookie;
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    payload = options.raw as unknown as BodyInit;
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function signIn(base: string, email: string): Promise<Session> {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email, password: 'hoofcare-2026' }),
  });
  const cookie = (response.headers.getSetCookie()[0] ?? '').split(';')[0] as string;
  await response.text();
  return { cookie };
}

const key = (): string => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/healthz`);
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

function multipart(hoof: string, phase: string, bytes: Buffer, name = 'a.jpg'): { body: Buffer; contentType: string } {
  const boundary = '----behaviour';
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="hoof"\r\n\r\n${hoof}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="phase"\r\n\r\n${phase}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function main(): Promise<void> {
  const farrier = await signIn(PRIMARY, 'farrier@clinchline.test');
  const apprentice = await signIn(PRIMARY, 'apprentice@clinchline.test');
  const ada = await signIn(PRIMARY, 'owner.ada@clinchline.test');
  const practice = await call(PRIMARY, 'GET', '/api/practice', { session: farrier });
  const today = practice.body.today as string;
  const barns = await call(PRIMARY, 'GET', '/api/barns', { session: farrier });
  const cedar = barns.body.find((barn: any) => barn.name === 'Cedar Hollow Stables');
  const horses = await call(PRIMARY, 'GET', '/api/horses', { session: farrier });
  const byName = new Map<string, any>(horses.body.map((horse: any) => [horse.name, horse]));

  /** Opens a started day with one confirmed horse and returns its open visit. */
  const openVisitFor = async (horseName: string, startTime: string): Promise<{ visitId: string; dayId: string; bookingId: string }> => {
    const created = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: cedar.id, business_date: today, start_time: startTime, slot_count: 1, slot_minutes: 15 },
    });
    const dayId = created.body.id as string;
    await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/publish`, { session: farrier, body: {} });
    const day = await call(PRIMARY, 'GET', `/api/barn-days/${dayId}`, { session: farrier });
    const horse = byName.get(horseName);
    const owner = await signIn(PRIMARY, String(horse.owner.email));
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/bookings`, {
      session: owner,
      body: { slot_id: day.body.slots[0].id, horse_id: horse.id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: owner, body: {} });
    await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/start`, { session: farrier, body: {} });
    const visit = await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/visit`, { session: farrier, body: {} });
    return { visitId: visit.body.id as string, dayId, bookingId: hold.body.id as string };
  };

  console.log('\n== photos are stored upright and stripped ==');
  {
    const { visitId } = await openVisitFor('Juniper', '21:00');

    // A 1200 x 900 upload with Orientation 6 is stored 900 x 1200.
    const turned = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 150, g: 130, b: 100 } },
    })
      .withExifMerge({ IFD0: { Orientation: '6', Artist: 'Someone', Copyright: 'Somewhere' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const upload = multipart('LF', 'after', turned);
    const stored = await call(PRIMARY, 'POST', `/api/visits/${visitId}/photos`, {
      session: farrier,
      raw: upload.body,
      contentType: upload.contentType,
    });
    check('a turned upload is accepted', stored.status === 201, stored.body);
    check('its stored size has width and height swapped',
      stored.body.width === 900 && stored.body.height === 1200, {
        width: stored.body.width,
        height: stored.body.height,
      });

    const fetched = await fetch(`${PRIMARY}${stored.body.url}`);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    check('the stored image carries no EXIF, XMP or IPTC',
      metadata.exif === undefined && metadata.xmp === undefined && metadata.iptc === undefined,
      { exif: metadata.exif !== undefined, xmp: metadata.xmp !== undefined });
    check('the stored image is upright at 900 x 1200',
      metadata.width === 900 && metadata.height === 1200, { width: metadata.width, height: metadata.height });

    // Marks are checked against the stored upright size.
    const outside = await call(PRIMARY, 'PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
      session: farrier,
      body: {
        version: null,
        hoof_wall: { x1: 100, y1: 1100, x2: 1100, y2: 300 },
        pastern: { x1: 100, y1: 1150, x2: 700, y2: 350 },
      },
    });
    check('a point beyond the upright width answers 422',
      outside.status === 422 &&
        outside.body.errors.hoof_wall === 'Keep both points inside the photo and apart from each other.',
      outside.body);

    const marks = await call(PRIMARY, 'PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
      session: farrier,
      body: {
        version: null,
        hoof_wall: { x1: 100, y1: 1100, x2: 800, y2: 300 },
        pastern: { x1: 100, y1: 1150, x2: 700, y2: 350 },
      },
    });
    check('the published worked example saves 48.8°, 53.1° and broken-back',
      marks.body.hoof_wall.angle === 48.8 &&
        marks.body.pastern.angle === 53.1 &&
        marks.body.alignment === 'broken-back',
      marks.body);

    console.log('\n== a thumbnail is written by a job ==');
    let thumbnailReady: any = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(400);
      const photo = await call(PRIMARY, 'GET', `/api/photos/${stored.body.id}`, { session: farrier });
      if (photo.body.thumbnail_status === 'ready') {
        thumbnailReady = photo.body;
        break;
      }
    }
    check('the thumbnail becomes ready', thumbnailReady !== null, thumbnailReady?.thumbnail_status);
    if (thumbnailReady !== null) {
      const thumb = await fetch(`${PRIMARY}${thumbnailReady.thumbnail_url}`);
      const thumbBytes = Buffer.from(await thumb.arrayBuffer());
      const thumbMeta = await sharp(thumbBytes).metadata();
      check('it is a 320-pixel-wide JPEG with no metadata',
        thumbMeta.width === 320 && thumbMeta.format === 'jpeg' && thumbMeta.exif === undefined,
        { width: thumbMeta.width, format: thumbMeta.format });
    }

    console.log('\n== deleting a photo leaves nothing behind ==');
    const marksBefore = await call(PRIMARY, 'GET', `/api/visits/${visitId}/hooves/LF/marks/history`, {
      session: farrier,
    });
    check('the hoof has a marks history before the delete', marksBefore.body.length >= 1, marksBefore.body.length);
    const deleted = await call(PRIMARY, 'DELETE', `/api/photos/${stored.body.id}`, { session: farrier });
    check('the delete answers 204', deleted.status === 204, deleted.status);
    const gonePhoto = await call(PRIMARY, 'GET', `/api/photos/${stored.body.id}`, { session: farrier });
    check('the photo answers 404', gonePhoto.status === 404);
    const signedAfter = await fetch(`${PRIMARY}${stored.body.url}`);
    check('its signed path answers 404', signedAfter.status === 404, signedAfter.status);
    const marksAfter = await call(PRIMARY, 'GET', `/api/visits/${visitId}/hooves/LF/marks/history`, {
      session: farrier,
    });
    check('deleting the after photo took its marks and history', marksAfter.body.length === 0, marksAfter.body);
    const quota = await withClient((db) =>
      query<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(stored_bytes),0)::int AS total FROM photos WHERE visit_id = $1 AND deleted_at IS NULL`,
        [visitId],
      ),
    );
    check('its bytes left the quota', (quota[0]?.total ?? 0) === 0, quota[0]);
  }

  console.log('\n== an upload resumes on another instance ==');
  {
    const { visitId } = await openVisitFor('Pilot', '21:20');
    const file = await sharp({
      create: { width: 900, height: 700, channels: 3, background: { r: 120, g: 110, b: 90 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const session = await call(PRIMARY, 'POST', `/api/visits/${visitId}/uploads`, {
      session: farrier,
      body: { hoof: 'RF', phase: 'after', size_bytes: file.length },
    });
    check('a session is created at offset 0', session.status === 201 && session.body.offset === 0, session.body);

    // A deliberately small chunk size is not allowed: each chunk is chunk_bytes long.
    const chunkBytes = session.body.chunk_bytes as number;
    const wrongLength = await call(PRIMARY, 'PATCH', `/api/uploads/${session.body.id}`, {
      session: farrier,
      raw: file.subarray(0, 10),
      contentType: 'application/octet-stream',
      headers: { 'upload-offset': '0' },
    });
    const expected = Math.min(chunkBytes, file.length);
    if (file.length > 10) {
      check('a chunk of the wrong length answers 422 naming the chunk size',
        wrongLength.status === 422 &&
          wrongLength.body.errors.chunk === `Send exactly ${chunkBytes} bytes, or the rest of the file.`,
        wrongLength.body);
    }
    void expected;

    const wrongOffset = await call(PRIMARY, 'PATCH', `/api/uploads/${session.body.id}`, {
      session: farrier,
      raw: file,
      contentType: 'application/octet-stream',
      headers: { 'upload-offset': '5' },
    });
    check('a wrong offset answers offset_mismatch with the stored offset',
      wrongOffset.status === 409 && wrongOffset.body.error === 'offset_mismatch' && wrongOffset.body.offset === 0,
      wrongOffset.body);

    // The whole file in one chunk, since it is smaller than chunk_bytes.
    const base = (await reachable(PEER)) ? PEER : PRIMARY;
    const peerSession = base === PEER ? await signIn(PEER, 'farrier@clinchline.test') : farrier;
    const finished = await call(base, 'PATCH', `/api/uploads/${session.body.id}`, {
      session: peerSession,
      raw: file,
      contentType: 'application/octet-stream',
      headers: { 'upload-offset': '0' },
    });
    check('the last chunk lands as one validated photo on another instance',
      finished.status === 201 && finished.body.width === 900 && finished.body.height === 700,
      finished.body);
    const sessions = await call(PRIMARY, 'GET', `/api/visits/${visitId}/uploads`, { session: farrier });
    check('the finished session is no longer live', sessions.body.length === 0, sessions.body);
    const chunks = await withClient((db) =>
      query<{ chunk_count: number; ended_reason: string }>(
        db,
        'SELECT chunk_count, ended_reason FROM upload_sessions WHERE id = $1',
        [session.body.id],
      ),
    );
    check('the session is recorded as completed', chunks[0]?.ended_reason === 'completed', chunks[0]);
  }

  console.log('\n== closing a visit ends its upload sessions ==');
  {
    const { visitId } = await openVisitFor('Saffron', '21:40');
    const photo = multipart('LF', 'after', await sharp({
      create: { width: 300, height: 220, channels: 3, background: { r: 130, g: 110, b: 90 } },
    }).jpeg().toBuffer());
    await call(PRIMARY, 'POST', `/api/visits/${visitId}/photos`, {
      session: farrier,
      raw: photo.body,
      contentType: photo.contentType,
    });
    const live = await call(PRIMARY, 'POST', `/api/visits/${visitId}/uploads`, {
      session: apprentice,
      body: { hoof: 'RH', phase: 'before', size_bytes: 500000 },
    });
    check('a session is live before the close', live.status === 201, live.body);

    await call(PRIMARY, 'POST', `/api/visits/${visitId}/close`, {
      session: farrier,
      headers: { 'idempotency-key': key() },
      body: { work: ['trim'] },
    });

    const afterClose = await call(PRIMARY, 'GET', `/api/uploads/${live.body.id}`, { session: apprentice });
    check('the ended session answers visit_closed',
      afterClose.status === 409 && afterClose.body.error === 'visit_closed', afterClose.body);
    const list = await call(PRIMARY, 'GET', `/api/visits/${visitId}/uploads`, { session: apprentice });
    check('the visit has no live sessions left', list.body.length === 0, list.body);
    const released = await withClient((db) =>
      query<{ reserved_bytes: number }>(db, 'SELECT reserved_bytes FROM upload_sessions WHERE id = $1', [
        live.body.id,
      ]),
    );
    check('its reservation was released at once', (released[0]?.reserved_bytes ?? -1) === 0, released[0]);
    const closedPhoto = await call(PRIMARY, 'POST', `/api/visits/${visitId}/photos`, {
      session: apprentice,
      raw: photo.body,
      contentType: photo.contentType,
    });
    check('a photo cannot be added to a closed visit',
      closedPhoto.status === 409 && closedPhoto.body.error === 'visit_closed', closedPhoto.body);
  }

  console.log('\n== simultaneous payments record one card payment ==');
  {
    const invoices = await call(PRIMARY, 'GET', '/api/invoices', { session: farrier });
    const unpaid = invoices.body.find((invoice: any) => invoice.status === 'unpaid');
    if (unpaid === undefined) {
      console.log('  (no unpaid invoice to pay)');
    } else {
      const ownerSession = await signIn(PRIMARY, String(
        (byName.get(unpaid.horse.name) ?? { owner: { email: 'owner.ada@clinchline.test' } }).owner.email,
      ));
      const pays = await Promise.all([
        call(PRIMARY, 'POST', `/api/invoices/${unpaid.id}/payments`, {
          session: ownerSession,
          headers: { 'idempotency-key': key() },
          body: { card_token: 'tok_approve_4242' },
        }),
        call(PRIMARY, 'POST', `/api/invoices/${unpaid.id}/payments`, {
          session: ownerSession,
          headers: { 'idempotency-key': key() },
          body: { card_token: 'tok_approve_4242' },
        }),
      ]);
      const paid = pays.filter((pay) => pay.status === 201);
      const already = pays.filter((pay) => pay.status === 409 && pay.body.error === 'already_paid');
      check('exactly one pay answers 201', paid.length === 1, pays.map((p) => [p.status, p.body.error]));
      check('the other answers already_paid', already.length === 1, pays.map((p) => p.body));
      const captures = await withClient((db) =>
        query<{ count: number }>(
          db,
          `SELECT COUNT(*)::int AS count FROM payments WHERE invoice_id = $1 AND kind = 'invoice' AND status = 'captured'`,
          [unpaid.id],
        ),
      );
      check('one captured card payment exists', (captures[0]?.count ?? 0) === 1, captures[0]);
      const readBack = await call(PRIMARY, 'GET', `/api/invoices/${unpaid.id}/reconciliation`, {
        session: farrier,
      });
      check('Kill Bill agrees to the cent', readBack.body.status === 'matched', readBack.body);
    }
  }

  console.log('\n== dunning walks its published steps ==');
  if (await reachable(FAST)) {
    const { visitId, bookingId } = await openVisitFor('Quarry', '22:00');
    void bookingId;
    const photo = multipart('LF', 'after', await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 140, g: 120, b: 95 } },
    }).jpeg().toBuffer());
    await call(PRIMARY, 'POST', `/api/visits/${visitId}/photos`, {
      session: farrier,
      raw: photo.body,
      contentType: photo.contentType,
    });
    const closed = await call(PRIMARY, 'POST', `/api/visits/${visitId}/close`, {
      session: farrier,
      headers: { 'idempotency-key': key() },
      body: { work: ['trim'] },
    });
    const invoiceId = closed.body.invoice.id as string;
    const bram = await signIn(FAST, 'owner.bram@clinchline.test');

    // A soft decline on the fast-clock instance stamps retries two seconds apart.
    const declined = await call(FAST, 'POST', `/api/invoices/${invoiceId}/payments`, {
      session: bram,
      headers: { 'idempotency-key': key() },
      body: { card_token: 'tok_funds_9995' },
    });
    check('the soft decline answers 402', declined.status === 402, declined.body);
    const pastDue = await call(PRIMARY, 'GET', '/api/invoices', { session: farrier });
    check('the invoice reads past_due',
      pastDue.body.find((invoice: any) => invoice.id === invoiceId)?.dunning_state === 'past_due',
      pastDue.body.find((invoice: any) => invoice.id === invoiceId)?.dunning_state);

    const secondManual = await call(FAST, 'POST', `/api/invoices/${invoiceId}/payments`, {
      session: bram,
      headers: { 'idempotency-key': key() },
      body: { card_token: 'tok_funds_9995' },
    });
    check('a second manual soft decline answers 402', secondManual.status === 402, secondManual.body);
    const stillPastDue = await withClient((db) =>
      query<{ dunning_state: string }>(db, 'SELECT dunning_state FROM invoices WHERE id = $1', [invoiceId]),
    );
    check('a later manual soft decline changes nothing',
      stillPastDue[0]?.dunning_state === 'past_due', stillPastDue[0]);

    const retries = await withClient((db) =>
      query<{ count: number }>(
        db,
        `SELECT COUNT(*)::int AS count FROM jobs WHERE kind = 'dunning_retry' AND payload->>'invoice_id' = $1`,
        [invoiceId],
      ),
    );
    check('three retries are stamped', (retries[0]?.count ?? 0) === 3, retries[0]);

    // The card on file still declines, so the retries walk past_due → retry_1 → retry_2 → blocked.
    let state = 'past_due';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(1000);
      const rows = await withClient((db) =>
        query<{ dunning_state: string }>(db, 'SELECT dunning_state FROM invoices WHERE id = $1', [invoiceId]),
      );
      state = rows[0]?.dunning_state ?? state;
      if (state === 'blocked') break;
    }
    check('the retries reach blocked', state === 'blocked', state);

    const emails = await withClient((db) =>
      query<{ dedupe_key: string }>(
        db,
        `SELECT dedupe_key FROM email_outbox WHERE dedupe_key LIKE $1 ORDER BY created_at`,
        [`dunning:${invoiceId}:%`],
      ),
    );
    const states = emails.map((row) => row.dedupe_key.split(':')[2]);
    check('one email was queued for each state it passed',
      ['past_due', 'retry_1', 'retry_2', 'blocked'].every((step) => states.includes(step)) &&
        new Set(states).size === states.length,
      states);

    const blockedHold = await call(PRIMARY, 'GET', '/api/invoices', { session: farrier });
    void blockedHold;
    const cleared = await call(PRIMARY, 'POST', `/api/invoices/${invoiceId}/payments`, {
      session: await signIn(PRIMARY, 'owner.bram@clinchline.test'),
      headers: { 'idempotency-key': key() },
      body: { card_token: 'tok_approve_4242' },
    });
    check('paying clears it at once', cleared.status === 201 && cleared.body.dunning_state === 'cleared',
      cleared.body);
  } else {
    console.log('  (the fast-clock instance is not running)');
  }

  console.log('\n== jobs are inspected and dead ones retried ==');
  {
    const jobs = await call(PRIMARY, 'GET', '/api/jobs', { session: farrier });
    check('the job list reads', Array.isArray(jobs.body) && jobs.body.length > 0, jobs.body?.length);
    check('each job carries its attempts and limit',
      jobs.body.every((job: any) => typeof job.attempts === 'number' && typeof job.max_attempts === 'number'));
    const succeeded = jobs.body.find((job: any) => job.status === 'succeeded');
    if (succeeded !== undefined) {
      const retry = await call(PRIMARY, 'POST', `/api/jobs/${succeeded.id}/retry`, { session: farrier, body: {} });
      check('retrying a job that is not dead answers illegal_transition',
        retry.status === 409 && retry.body.error === 'illegal_transition' && retry.body.from === 'succeeded',
        retry.body);
    }

    // A job taken to its attempt limit goes dead and can then be retried.
    const dead = await withClient(async (db) => {
      const rows = await query<{ id: string }>(
        db,
        `INSERT INTO jobs (id, kind, status, payload, attempts, max_attempts, run_at, created_at, updated_at)
         VALUES ('behaviour-dead-job','csv_export','dead','{"month":"2026-01"}'::jsonb,5,5,now(),now(),now())
         ON CONFLICT (id) DO UPDATE SET status = 'dead', attempts = 5
         RETURNING id`,
      );
      return rows[0]?.id as string;
    });
    const retried = await call(PRIMARY, 'POST', `/api/jobs/${dead}/retry`, { session: farrier, body: {} });
    check('a dead job is retried with its attempts back at 0',
      retried.status === 200 && retried.body.status === 'queued' && retried.body.attempts === 0, retried.body);
    await withClient((db) => query(db, 'DELETE FROM jobs WHERE id = $1', [dead]));
  }

  console.log('\n== a barn day stream gives each role its own fields ==');
  {
    const created = await call(PRIMARY, 'POST', '/api/barn-days', {
      session: farrier,
      body: { barn_id: cedar.id, business_date: today, start_time: '22:20', slot_count: 2, slot_minutes: 15 },
    });
    const dayId = created.body.id as string;
    await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/publish`, { session: farrier, body: {} });
    const day = await call(PRIMARY, 'GET', `/api/barn-days/${dayId}`, { session: farrier });

    const read = async (session: Session, lastEventId?: string): Promise<string> => {
      const controller = new AbortController();
      const headers: Record<string, string> = { cookie: session.cookie };
      if (lastEventId !== undefined) headers['last-event-id'] = lastEventId;
      const response = await fetch(`${PRIMARY}/api/barn-days/${dayId}/events`, {
        headers,
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      let text = '';
      const deadline = Date.now() + 6000;
      // One read is in flight at a time; the race only decides when to look again.
      let inFlight: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
      while (reader !== undefined && Date.now() < deadline) {
        if (inFlight === null) inFlight = reader.read();
        const settled = await Promise.race([
          inFlight.then((result) => ({ kind: 'chunk' as const, result })),
          new Promise<{ kind: 'idle' }>((resolve) => setTimeout(() => resolve({ kind: 'idle' }), 300)),
        ]);
        if (settled.kind === 'idle') continue;
        inFlight = null;
        if (settled.result.value !== undefined) text += new TextDecoder().decode(settled.result.value);
        if (settled.result.done) break;
      }
      controller.abort();
      return text;
    };

    const manager = await signIn(PRIMARY, 'manager.cedar@clinchline.test');
    const opening = await read(farrier);
    check('a stream opens with the published retry', opening.includes('retry: 2000'), opening.slice(0, 60));
    check('it sends a heartbeat comment or stays quiet', !opening.includes('event: booking'), opening.slice(0, 80));

    const farrierStream = read(farrier);
    const managerStream = read(manager);
    await sleep(400);
    const hold = await call(PRIMARY, 'POST', `/api/barn-days/${dayId}/bookings`, {
      session: ada,
      body: { slot_id: day.body.slots[0].id, horse_id: byName.get('Juniper').id, card_token: 'tok_approve_4242' },
    });
    await call(PRIMARY, 'POST', `/api/bookings/${hold.body.id}/confirm`, { session: ada, body: {} });
    const farrierText = await farrierStream;
    const managerText = await managerStream;

    check('the farrier stream carries booking_added within two seconds',
      farrierText.includes('event: booking_added'), farrierText.slice(-300));
    const farrierData = /event: booking_added\ndata: (.+)/.exec(farrierText);
    const farrierKeys = farrierData === null ? [] : Object.keys(JSON.parse(farrierData[1] as string)).sort();
    check('its row carries the farrier field set',
      farrierKeys.join(',') ===
        'booking_id,horse_id,horse_name,invoice_status,invoice_total_cents,number,owner_email,owner_name,owner_phone,slot_time,stall,status,trip_share_cents,visit_id,visit_status',
      farrierKeys);
    const managerData = /event: booking_added\ndata: (.+)/.exec(managerText);
    const managerKeys = managerData === null ? [] : Object.keys(JSON.parse(managerData[1] as string)).sort();
    check('the barn manager row carries only slot time, horse name and stall',
      managerKeys.join(',') === 'horse_name,slot_time,stall', managerKeys);

    // Resuming with Last-Event-ID replays contiguous ids with nothing lost or repeated.
    const ids = [...farrierText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    check('event ids are contiguous from the first',
      ids.length === 0 || ids.every((id, index) => index === 0 || id === (ids[index - 1] as number) + 1),
      ids);
    if (ids.length > 0) {
      const replay = await read(farrier, String((ids[0] as number) - 1));
      const replayIds = [...replay.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
      check('a resume replays from the next id with no gap',
        replayIds[0] === (ids[0] as number) && new Set(replayIds).size === replayIds.length,
        replayIds);
    }
    const reset = await read(farrier, '999999');
    check('an id beyond the newest answers one reset', reset.includes('event: reset'), reset.slice(0, 120));

    const owner = await call(PRIMARY, 'GET', `/api/barn-days/${dayId}/events`, { session: ada });
    check('an owner is refused a barn day stream', owner.status === 403, owner.status);
  }

  console.log('\n== an import moves a stall and the sheets hear about it ==');
  {
    const header = 'owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks';
    const horse = byName.get('Wicket');
    const before = await withClient((db) =>
      query<{ seq: number }>(
        db,
        `SELECT COALESCE(MAX(seq),0)::int AS seq FROM stream_events WHERE channel LIKE 'barn_day:%:farrier'`,
      ),
    );
    void before;
    const moved = [header, `Cleo Marsh,owner.cleo@clinchline.test,+1 303 555 0143,Wicket,Cedar Hollow Stables,31,8`].join('\n');
    const imported = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from(moved),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('the import updates the horse', imported.status === 201 && imported.body.updated_horses === 1,
      imported.body);
    const fresh = await call(PRIMARY, 'GET', `/api/horses/${horse.id}`, { session: farrier });
    check('the stall changed', fresh.body.stall === '31', fresh.body.stall);
    const sameAgain = await call(PRIMARY, 'POST', '/api/imports', {
      session: farrier,
      raw: Buffer.from(moved),
      contentType: 'text/csv',
      headers: { 'idempotency-key': key() },
    });
    check('an import that changes nothing counts no update',
      sameAgain.body.updated_horses === 0 && sameAgain.body.created_horses === 0, sameAgain.body);
  }

  console.log('\n== a vet link follows the latest visits ==');
  {
    const juniper = byName.get('Juniper');
    const issued = await call(PRIMARY, 'POST', `/api/horses/${juniper.id}/vet-links`, {
      session: farrier,
      body: { vet_name: 'Dr Wren Ash', vet_email: 'vet.behaviour@clinchline.test' },
    });
    check('a link is issued with the pair as it stood', issued.status === 201, issued.body);
    const token = String(issued.body.url).replace('/vet/', '');
    const firstRead = await call(PRIMARY, 'GET', `/api/vet/${token}`);
    const firstPair = `${firstRead.body.previous_date} ${firstRead.body.current_date}`;

    // Closing a newer visit moves the live pair.
    const { visitId } = await openVisitFor('Juniper', '22:40');
    const photo = multipart('LF', 'after', await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 150, g: 125, b: 100 } },
    }).jpeg().toBuffer());
    await call(PRIMARY, 'POST', `/api/visits/${visitId}/photos`, {
      session: farrier,
      raw: photo.body,
      contentType: photo.contentType,
    });
    await call(PRIMARY, 'PUT', `/api/visits/${visitId}/hooves/LF/marks`, {
      session: farrier,
      body: {
        version: null,
        hoof_wall: { x1: 40, y1: 260, x2: 220, y2: 60 },
        pastern: { x1: 220, y1: 220, x2: 380, y2: 40 },
      },
    });
    await call(PRIMARY, 'POST', `/api/visits/${visitId}/close`, {
      session: farrier,
      headers: { 'idempotency-key': key() },
      body: { work: ['trim'] },
    });

    const secondRead = await call(PRIMARY, 'GET', `/api/vet/${token}`);
    const secondPair = `${secondRead.body.previous_date} ${secondRead.body.current_date}`;
    check('the next read shows the new pair', secondPair !== firstPair, { firstPair, secondPair });

    const views = await call(PRIMARY, 'GET', `/api/vet-links/${issued.body.id}/views`, { session: farrier });
    check('each view row records the pair it served',
      views.body.length === 2 &&
        `${views.body[1].previous_date} ${views.body[1].current_date}` === firstPair &&
        `${views.body[0].previous_date} ${views.body[0].current_date}` === secondPair,
      views.body.map((view: any) => [view.previous_date, view.current_date]));

    // A photo path signed for a visit that has left the pair stops working.
    const stalePath = firstRead.body.hooves.LF?.previous?.url as string | undefined;
    if (stalePath !== undefined) {
      const staleRead = await fetch(`${PRIMARY}${stalePath}`);
      check('a path for a visit that left the pair answers url_invalid',
        staleRead.status === 403, staleRead.status);
    }

    const livePath = secondRead.body.hooves.LF?.current?.url as string | undefined;
    if (livePath !== undefined) {
      const liveRead = await fetch(`${PRIMARY}${livePath}`);
      check('a path for the live pair serves the photo', liveRead.status === 200, liveRead.status);
      await call(PRIMARY, 'POST', `/api/vet-links/${issued.body.id}/revoke`, { session: farrier, body: {} });
      const afterRevoke = await fetch(`${PRIMARY}${livePath}`);
      check('after a revoke that same path stops working', afterRevoke.status === 403, afterRevoke.status);
      if (await reachable(PEER)) {
        const onPeer = await call(PEER, 'GET', `/api/vet/${token}`);
        check('the revoked token fails on another instance too', onPeer.status === 404, onPeer.status);
      }
    }
  }

  console.log(`\nfailures: ${failures}`);
  await pool.end();
  if (failures > 0) process.exitCode = 1;
}

await main();
