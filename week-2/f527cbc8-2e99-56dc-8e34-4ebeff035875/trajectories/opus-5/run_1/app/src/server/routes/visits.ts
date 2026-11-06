import type { PoolClient } from 'pg';
import { limits } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import {
  ValidationError,
  conflict,
  fieldMessages,
  illegalTransition,
  notFound,
} from '../errors.js';
import { callerActor, type Caller } from '../auth.js';
import { writeAudit } from '../audit.js';
import { appendEvent, barnDayChannel, horseChannel } from '../stream.js';
import { withIdempotency } from '../idempotency.js';
import { practice } from '../domain/practice.js';
import { loadBarnDay, type BarnDayRow } from '../domain/barndays.js';
import { announceBookingChange, onBarnDay } from '../domain/dayengine.js';
import { excusePool } from '../domain/split.js';
import { isWorkCode, priceListInForce, SERVICE_NAMES } from '../domain/prices.js';
import type { WorkCode } from '../domain/cards.js';
import {
  createInvoiceRow,
  depositCreditCents,
  depositCreditDescription,
  finishInvoiceInKillBill,
  grossOf,
  invoiceJson,
  loadInvoice,
  tripShareDescription,
  type InvoiceItem,
} from '../domain/invoicing.js';
import { depositPaymentForBooking, refundPayment } from '../domain/payments.js';
import { queueRequestEmail } from '../services/mail.js';
import { excusedEmail } from '../services/emails.js';
import { signPhotoPath } from '../services/signing.js';
import { formatInstant } from '../domain/time.js';
import { HOOVES, type Hoof } from '../domain/marks.js';
import { loadBooking, bookingJson } from './bookings.js';
import { allocationBody } from './allocation.js';
import { endUploadSessionsForVisit, removeUploadChunks } from './uploads.js';

/**
 * Visits. A visit opens on a started day, carries the hoof photos and marks, and closes
 * into exactly one invoice at the price in force on the barn day's business date.
 */
export type VisitStatus = 'open' | 'closed' | 'invoice_pending' | 'invoiced';

export interface VisitRow {
  id: string;
  horse_id: string;
  horse_name: string;
  owner_id: string;
  booking_id: string | null;
  barn_day_id: string | null;
  business_date: string;
  status: VisitStatus;
  note: string | null;
  seeded_history: boolean;
}

const VISIT_COLUMNS = `v.id, v.horse_id, h.name AS horse_name, h.owner_id, v.booking_id,
  v.barn_day_id, to_char(v.business_date,'YYYY-MM-DD') AS business_date, v.status, v.note,
  v.seeded_history`;

export async function loadVisit(db: Db, id: string, lock = false): Promise<VisitRow | null> {
  if (lock) {
    const locked = await queryOne<{ id: string }>(db, 'SELECT id FROM visits WHERE id = $1 FOR UPDATE', [id]);
    if (locked === null) return null;
  }
  return await queryOne<VisitRow>(
    db,
    `SELECT ${VISIT_COLUMNS} FROM visits v JOIN horses h ON h.id = v.horse_id WHERE v.id = $1`,
    [id],
  );
}

/** Owners never see open visits; a barn manager reaches no visit at all. */
export async function visibleVisit(db: Db, caller: Caller, id: string, lock = false): Promise<VisitRow> {
  const visit = await loadVisit(db, id, lock);
  if (visit === null) throw notFound();
  if (caller.role === 'barn_manager') throw notFound();
  if (caller.role === 'owner') {
    if (visit.owner_id !== caller.userId) throw notFound();
    if (visit.status === 'open') throw notFound();
  }
  return visit;
}

interface PhotoRow {
  id: string;
  visit_id: string;
  hoof: Hoof;
  phase: 'before' | 'after';
  content_type: string;
  width: number;
  height: number;
  thumbnail_status: 'pending' | 'ready' | 'failed';
  thumbnail_key: string | null;
}

export async function photoJson(
  db: Db,
  photo: PhotoRow,
  options: { vetLinkId?: string | null; omitIds?: boolean } = {},
): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const signed = await signPhotoPath(db, photo.id, { vetLinkId: options.vetLinkId ?? null });
  const thumbnail =
    photo.thumbnail_status === 'ready'
      ? await signPhotoPath(db, photo.id, { thumbnail: true, vetLinkId: options.vetLinkId ?? null })
      : null;
  const body: Record<string, unknown> = {
    hoof: photo.hoof,
    phase: photo.phase,
    content_type: photo.content_type,
    width: photo.width,
    height: photo.height,
    url: signed.url,
    url_expires_at: formatInstant(signed.expiresAt, timeZone),
  };
  if (options.omitIds !== true) {
    body.id = photo.id;
    body.visit_id = photo.visit_id;
    body.thumbnail_status = photo.thumbnail_status;
    body.thumbnail_url = thumbnail === null ? null : thumbnail.url;
  }
  return body;
}

export async function visitPhotos(db: Db, visitId: string): Promise<PhotoRow[]> {
  return await query<PhotoRow>(
    db,
    `SELECT id, visit_id, hoof, phase, content_type, width, height, thumbnail_status, thumbnail_key
     FROM photos WHERE visit_id = $1 AND deleted_at IS NULL ORDER BY hoof, phase`,
    [visitId],
  );
}

export interface MarksRow {
  visit_id: string;
  hoof: Hoof;
  version: number;
  wall_x1: number;
  wall_y1: number;
  wall_x2: number;
  wall_y2: number;
  past_x1: number;
  past_y1: number;
  past_x2: number;
  past_y2: number;
  wall_angle: number;
  past_angle: number;
  alignment: string;
  saved_by: string;
  saver_name: string;
  saver_role: string;
  saved_at: Date;
  restored_from: number | null;
}

export const MARKS_COLUMNS = `m.visit_id, m.hoof, m.version, m.wall_x1, m.wall_y1, m.wall_x2, m.wall_y2,
  m.past_x1, m.past_y1, m.past_x2, m.past_y2, m.wall_angle, m.past_angle, m.alignment,
  m.saved_by, u.name AS saver_name, u.role AS saver_role, m.saved_at, m.restored_from`;

export async function currentMarks(db: Db, visitId: string, hoof: Hoof): Promise<MarksRow | null> {
  return await queryOne<MarksRow>(
    db,
    `SELECT ${MARKS_COLUMNS} FROM hoof_marks m JOIN users u ON u.id = m.saved_by
     WHERE m.visit_id = $1 AND m.hoof = $2 AND m.current`,
    [visitId, hoof],
  );
}

export function marksJson(marks: MarksRow, forStaff: boolean, timeZone: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    hoof: marks.hoof,
    version: marks.version,
    hoof_wall: {
      x1: marks.wall_x1,
      y1: marks.wall_y1,
      x2: marks.wall_x2,
      y2: marks.wall_y2,
      angle: Number(marks.wall_angle),
    },
    pastern: {
      x1: marks.past_x1,
      y1: marks.past_y1,
      x2: marks.past_x2,
      y2: marks.past_y2,
      angle: Number(marks.past_angle),
    },
    alignment: marks.alignment,
  };
  if (forStaff) {
    body.saved_by = { id: marks.saved_by, name: marks.saver_name, role: marks.saver_role };
    body.saved_at = formatInstant(marks.saved_at, timeZone);
    body.restored_from = marks.restored_from;
  }
  return body;
}

export async function visitBody(db: Db, visit: VisitRow, caller: Caller): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const photos = await visitPhotos(db, visit.id);
  const photoBodies: Record<string, unknown>[] = [];
  for (const photo of photos) photoBodies.push(await photoJson(db, photo));

  const marks: Record<string, unknown>[] = [];
  for (const hoof of HOOVES) {
    const found = await currentMarks(db, visit.id, hoof);
    if (found !== null) {
      marks.push(marksJson(found, caller.role === 'farrier' || caller.role === 'apprentice', timeZone));
    }
  }

  // The apprentice receives the same keys with `invoice` always null.
  let invoice: Record<string, unknown> | null = null;
  if (caller.role !== 'apprentice') {
    const row = await queryOne<{ id: string }>(
      db,
      `SELECT id FROM invoices WHERE visit_id = $1 AND kind = 'visit'`,
      [visit.id],
    );
    if (row !== null) {
      const loaded = await loadInvoice(db, row.id);
      invoice = loaded === null ? null : invoiceJson(loaded);
    }
  }

  return {
    id: visit.id,
    status: visit.status,
    horse: { id: visit.horse_id, name: visit.horse_name },
    booking_id: visit.booking_id,
    business_date: visit.business_date,
    note: visit.note,
    photos: photoBodies,
    marks,
    invoice,
  };
}

interface CloseInput {
  work: WorkCode[];
  note: string | null;
}

function readCloseInput(body: Record<string, unknown>): CloseInput {
  const errors: Record<string, string> = {};
  const rawWork = Array.isArray(body.work) ? body.work : [];
  const work: WorkCode[] = [];
  for (const entry of rawWork) {
    if (isWorkCode(entry) && !work.includes(entry)) work.push(entry);
  }
  if (work.length === 0) errors.work = fieldMessages.required;

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    if (typeof body.note !== 'string' || body.note.length > limits.visitNoteChars) {
      errors.note = fieldMessages.range(0, limits.visitNoteChars);
    } else note = body.note;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { work, note };
}

/** The items a visit invoice carries, at the price in force on the barn day's business date. */
async function visitInvoiceItems(
  db: Db,
  visit: VisitRow,
  work: readonly WorkCode[],
  shareCents: number,
  day: BarnDayRow | null,
): Promise<InvoiceItem[]> {
  const list = await priceListInForce(db, visit.business_date);
  if (list === null) throw new Error('no price list is in force');
  const items: InvoiceItem[] = work.map((code) => ({
    description: `${SERVICE_NAMES[code]} — ${visit.horse_name}`,
    amount_cents: list.prices[code],
  }));
  if (shareCents > 0 && day !== null) {
    items.push({
      description: tripShareDescription(day.barn_name, day.business_date),
      amount_cents: shareCents,
    });
  }
  const deposit = visit.booking_id === null ? null : await depositPaymentForBooking(db, visit.booking_id);
  const credit = depositCreditCents(deposit, grossOf(items));
  if (credit > 0) {
    items.push({
      description: depositCreditDescription(visit.horse_name, visit.business_date),
      amount_cents: -credit,
    });
  }
  return items;
}

export function registerVisitRoutes(): void {
  route({
    method: 'POST',
    path: '/api/bookings/:id/visit',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient((db) => loadBooking(db, bookingId));
      if (located === null) throw notFound();
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const result = await onBarnDay(located.barn_day_id, context, async (db, day) => {
        const at = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        if (booking.status !== 'confirmed') throw illegalTransition(booking.status, 'open_visit');
        if (day.status !== 'in_progress') throw conflict('day_not_in_progress');

        const visitId = newId();
        await query(
          db,
          `INSERT INTO visits (id, horse_id, booking_id, barn_day_id, business_date, status, created_at)
           VALUES ($1,$2,$3,$4,$5,'open',$6)`,
          [visitId, booking.horse_id, booking.id, day.id, day.business_date, at],
        );
        await query(db, `UPDATE bookings SET status = 'worked' WHERE id = $1`, [booking.id]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'open_visit',
          entityType: 'visit',
          entityId: visitId,
          to: 'open',
          at,
          requestId: ctx.requestId,
        });
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'open_visit',
          entityType: 'booking',
          entityId: booking.id,
          from: 'confirmed',
          to: 'worked',
          at,
          requestId: ctx.requestId,
        });
        await announceBookingChange(db, day.id, booking.id, 'booking_moved', at);
        const visit = await loadVisit(db, visitId);
        if (visit === null) throw new Error('visit vanished');
        return await visitBody(db, visit, ctx.caller);
      });
      if (result === null) throw notFound();
      return json(201, result);
    },
  });

  route({
    method: 'POST',
    path: '/api/bookings/:id/no-show',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient((db) => loadBooking(db, bookingId));
      if (located === null) throw notFound();
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const result = await onBarnDay(located.barn_day_id, context, async (db, day) => {
        const at = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        if (booking.status !== 'confirmed') throw illegalTransition(booking.status, 'no_show');
        if (day.status !== 'in_progress') throw conflict('day_not_in_progress');
        await query(db, `UPDATE bookings SET status = 'no_show' WHERE id = $1`, [booking.id]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'no_show',
          entityType: 'booking',
          entityId: booking.id,
          from: 'confirmed',
          to: 'no_show',
          at,
          requestId: ctx.requestId,
        });
        const deposit = await depositPaymentForBooking(db, booking.id);
        if (deposit !== null && deposit.status === 'captured') {
          await query(db, `UPDATE payments SET disposition = 'forfeited' WHERE id = $1`, [deposit.id]);
        }
        await announceBookingChange(db, day.id, booking.id, 'booking_moved', at);
        const updated = await loadBooking(db, booking.id);
        if (updated === null) throw new Error('booking vanished');
        return await bookingJson(db, updated);
      });
      if (result === null) throw notFound();
      return json(200, result);
    },
  });

  route({
    method: 'POST',
    path: '/api/bookings/:id/excuse',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const bookingId = ctx.params.id as string;
      const located = await withClient((db) => loadBooking(db, bookingId));
      if (located === null) throw notFound();
      const context = {
        actor: callerActor(ctx.caller),
        requestId: ctx.requestId,
        queueKind: 'request' as const,
      };
      const result = await onBarnDay(located.barn_day_id, context, async (db, day) => {
        const at = now();
        const booking = await loadBooking(db, bookingId, true);
        if (booking === null) throw notFound();
        if (booking.status !== 'confirmed') throw illegalTransition(booking.status, 'excuse');
        if (day.status !== 'in_progress') throw conflict('day_not_in_progress');
        return await excuseBooking(db, day, booking.id, ctx, at);
      });
      if (result === null) throw notFound();
      return json(200, result);
    },
  });

  route({
    method: 'GET',
    path: '/api/visits/:id',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const visit = await visibleVisit(db, ctx.caller, ctx.params.id as string);
        return await visitBody(db, visit, ctx.caller);
      });
      return json(200, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/visits/:id/close',
    roles: ['farrier'],
    bodyKind: 'json',
    needsIdempotency: true,
    handler: async (ctx: Ctx) => {
      const visitId = ctx.params.id as string;
      await withClient((db) => visibleVisit(db, ctx.caller, visitId));
      const input = readCloseInput(ctx.body());

      const response = await withIdempotency(
        ctx.caller,
        `close_visit:${visitId}`,
        ctx.idempotencyKey as string,
        ctx.raw.length === 0 ? '{}' : ctx.raw,
        async () => {
          const closed = await withTransaction(async (db) => {
            const visit = await loadVisit(db, visitId, true);
            if (visit === null) throw notFound();
            if (visit.status !== 'open') throw illegalTransition(visit.status, 'close');

            const at = now();
            const afterPhoto = await queryOne<{ id: string }>(
              db,
              `SELECT id FROM photos WHERE visit_id = $1 AND phase = 'after' AND deleted_at IS NULL LIMIT 1`,
              [visit.id],
            );
            if (afterPhoto === null) throw conflict('photos_required');

            const day = visit.barn_day_id === null ? null : await loadBarnDay(db, visit.barn_day_id);
            const booking = visit.booking_id === null ? null : await loadBooking(db, visit.booking_id);
            const shareCents = booking?.share_cents ?? 0;
            const items = await visitInvoiceItems(db, visit, input.work, shareCents, day);

            await query(
              db,
              `UPDATE visits SET status = 'closed', note = $2, work_codes = $3, closed_at = $4
               WHERE id = $1`,
              [visit.id, input.note, input.work, at],
            );
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action: 'close',
              entityType: 'visit',
              entityId: visit.id,
              from: 'open',
              to: 'closed',
              at,
              requestId: ctx.requestId,
            });

            const invoice = await createInvoiceRow(db, {
              kind: 'visit',
              ownerId: visit.owner_id,
              horseId: visit.horse_id,
              visitId: visit.id,
              bookingId: visit.booking_id,
              barnDayId: visit.barn_day_id,
              businessDate: visit.business_date,
              items,
              actor: callerActor(ctx.caller),
              requestId: ctx.requestId,
              at,
            });

            // Closing ends the visit's live upload sessions and releases their reservations.
            const endedSessions = await endUploadSessionsForVisit(db, visit.id);
            await appendEvent(db, horseChannel(visit.horse_id, 'staff'), 'visit_closed', { visit_id: visit.id }, at);
            await appendEvent(db, horseChannel(visit.horse_id, 'owner'), 'visit_closed', { visit_id: visit.id }, at);
            if (day !== null && visit.booking_id !== null) {
              await announceBookingChange(db, day.id, visit.booking_id, 'booking_moved', at);
            }
            return { visitId: visit.id, invoiceId: invoice.id, endedSessions };
          });

          await finishInvoiceInKillBill(closed.invoiceId, {
            queueKind: 'request',
            actor: callerActor(ctx.caller),
            requestId: ctx.requestId,
          });
          void removeUploadChunks(closed.endedSessions);

          const body = await withClient(async (db) => {
            const visit = await loadVisit(db, closed.visitId);
            if (visit === null) throw notFound();
            const refreshed = await visitBody(db, visit, ctx.caller);
            if (visit.booking_id !== null && visit.barn_day_id !== null) {
              await withTransaction((inner) =>
                announceBookingChange(
                  inner as PoolClient,
                  visit.barn_day_id as string,
                  visit.booking_id as string,
                  'booking_moved',
                  now(),
                ),
              );
            }
            return refreshed;
          });
          return { status: 200, body };
        },
      );
      return json(response.status, response.body);
    },
  });
}

/**
 * Excusing a horse takes it out of the trip split, moves its share onto the counting
 * horses not yet billed as appended adjustments, refunds its captured deposit and tells
 * its owner.
 */
export async function excuseBooking(
  db: PoolClient,
  day: BarnDayRow,
  bookingId: string,
  ctx: Ctx,
  at: Date,
): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const counting = await query<{
    id: string;
    number: number;
    status: string;
    share_cents: number;
    visit_status: string | null;
  }>(
    db,
    `SELECT bk.id, bk.number::int AS number, bk.status, COALESCE(bk.share_cents,0) AS share_cents,
            v.status AS visit_status
     FROM bookings bk LEFT JOIN visits v ON v.booking_id = bk.id
     WHERE bk.barn_day_id = $1 AND bk.counts_for_trip = true AND bk.status <> 'excused'
     ORDER BY bk.number`,
    [day.id],
  );
  const excused = counting.find((row) => row.id === bookingId);
  if (excused === undefined) throw conflict('day_not_in_progress');

  // A counting booking's share is billed once its visit has left open.
  const billed = counting.filter(
    (row) => row.id !== bookingId && row.visit_status !== null && row.visit_status !== 'open',
  );
  const openRecipients = counting.filter(
    (row) => row.id !== bookingId && (row.visit_status === null || row.visit_status === 'open'),
  );

  const outcome = excusePool({
    tripFeeCents: day.trip_fee_cents,
    excused: { bookingId, number: excused.number, shareCents: excused.share_cents },
    billed: billed.map((row) => ({ bookingId: row.id, number: row.number, shareCents: row.share_cents })),
    openRecipients: openRecipients.map((row) => ({
      bookingId: row.id,
      number: row.number,
      shareCents: row.share_cents,
    })),
  });
  if (outcome.kind === 'no_share_recipient') throw conflict('no_share_recipient');

  await query(db, `UPDATE bookings SET status = 'excused' WHERE id = $1`, [bookingId]);
  await writeAudit(db, {
    actor: callerActor(ctx.caller),
    action: 'excuse',
    entityType: 'booking',
    entityId: bookingId,
    from: 'confirmed',
    to: 'excused',
    at,
    requestId: ctx.requestId,
  });

  const changed: { bookingId: string; number: number }[] = [];
  if (outcome.kind === 'adjusted') {
    const byNumber = new Map(counting.map((row) => [row.id, row]));
    const deltas = outcome.shares
      .map((share) => {
        const previous = byNumber.get(share.bookingId);
        return {
          bookingId: share.bookingId,
          number: previous?.number ?? 0,
          delta: share.shareCents - (previous?.share_cents ?? 0),
          shareCents: share.shareCents,
        };
      })
      .filter((entry) => entry.delta !== 0)
      .sort((left, right) => left.number - right.number);

    for (const entry of deltas) {
      await query(db, 'UPDATE bookings SET share_cents = $2 WHERE id = $1', [
        entry.bookingId,
        entry.shareCents,
      ]);
      const seq = await queryOne<{ seq: number }>(
        db,
        'UPDATE barn_days SET adjustment_seq = adjustment_seq + 1 WHERE id = $1 RETURNING adjustment_seq AS seq',
        [day.id],
      );
      await query(
        db,
        `INSERT INTO trip_share_adjustments (id, barn_day_id, seq, booking_id, delta_cents,
                                             cause_booking_id, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId(), day.id, seq?.seq ?? 0, entry.bookingId, entry.delta, bookingId, at],
      );
      changed.push({ bookingId: entry.bookingId, number: entry.number });
    }
  } else {
    await query(db, 'UPDATE bookings SET share_cents = 0 WHERE id = $1', [bookingId]);
  }

  const booking = await loadBooking(db, bookingId);
  if (booking === null) throw new Error('booking vanished');
  const owner = await queryOne<{ email: string; name: string }>(
    db,
    'SELECT email, name FROM users WHERE id = $1',
    [booking.owner_id],
  );
  if (owner === null) throw new Error('owner vanished');

  const deposit = await depositPaymentForBooking(db, bookingId);
  let refunded: number | null = null;
  if (deposit !== null && deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents > 0) {
    refunded = deposit.captured_cents - deposit.refunded_cents - deposit.applied_cents;
    await refundPayment(db, {
      payment: deposit,
      amountCents: refunded,
      reason: 'excused',
      owner,
      horseId: booking.horse_id,
      actor: callerActor(ctx.caller),
      requestId: ctx.requestId,
      at,
      timeZone,
    });
  }

  const message = excusedEmail(
    {
      horseName: booking.horse_name,
      barnName: day.barn_name,
      businessDate: day.business_date,
      slotTime: booking.slot_time,
      cutoff: '',
    },
    refunded,
  );
  await queueRequestEmail(db, {
    to: owner.email,
    subject: message.subject,
    body: message.body,
    dedupeKey: `excused:${bookingId}`,
  });

  // The farrier sees every changed row then the new allocation; the apprentice sees the
  // excused row; the barn manager sees it leave.
  const farrierRows = [{ bookingId, number: excused.number }, ...changed]
    .filter((entry, index, all) => all.findIndex((other) => other.bookingId === entry.bookingId) === index)
    .sort((left, right) => left.number - right.number);
  for (const row of farrierRows) {
    await announceBookingChange(db, day.id, row.bookingId, 'booking_moved', at, ['farrier']);
  }
  if (outcome.kind === 'adjusted') {
    await appendEvent(
      db,
      barnDayChannel(day.id, 'farrier'),
      'allocation_adjusted',
      await allocationBody(db, day),
      at,
    );
  }
  await announceBookingChange(db, day.id, bookingId, 'booking_moved', at, ['apprentice']);
  await announceBookingChange(db, day.id, bookingId, 'booking_removed', at, ['barn_manager']);

  return {
    booking: await bookingJson(db, booking),
    allocation: await allocationBody(db, day),
  };
}
