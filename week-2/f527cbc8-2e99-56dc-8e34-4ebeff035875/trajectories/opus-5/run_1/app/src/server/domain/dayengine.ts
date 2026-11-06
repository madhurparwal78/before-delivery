import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { now, plusSecondsCeil } from '../clock.js';
import { query, queryOne, withTransaction, type Db } from '../db.js';
import { newId } from '../util.js';
import { systemActor, writeAudit, type Actor } from '../audit.js';
import { appendEvent, barnDayChannel } from '../stream.js';
import { queueBackgroundEmail, queueRequestEmail } from '../services/mail.js';
import { offerLapsedEmail, waitlistOfferEmail } from '../services/emails.js';
import { chargeCard } from './cards.js';
import {
  announceDayStatus,
  bookedCount,
  dayStatusNow,
  loadBarnDay,
  slotsWithState,
  type BarnDayRow,
  type DayStatus,
} from './barndays.js';
import { depositForDate } from './prices.js';
import { practice } from './practice.js';
import { authorisePayment, loadPayment, voidPayment, type PaymentRow } from './payments.js';
import { wallTimeSecondsAt } from './time.js';
import {
  bookingRowSource,
  projectBookingRow,
  visibleToBarnManager,
} from './projection.js';

/**
 * Hold lapse and the offer pass. A hold is lapsed at and after its stored expiry
 * instant on every read and every write, whether or not any background job has run,
 * and whenever a slot is free the offer pass runs under the day's serialisation — so a
 * stranger's hold just after a lapse can never beat position 1.
 */
export interface DayWork<T> {
  (db: PoolClient, day: BarnDayRow): Promise<T>;
}

export interface DayContext {
  actor: Actor;
  requestId: string | null;
  /** Offer emails raised inside a request belong to that request's transaction. */
  queueKind: 'request' | 'background';
}

/** Takes the next booking number. Only successful holds take one, so there are no gaps. */
async function nextBookingNumber(db: Db): Promise<number> {
  const row = await queryOne<{ value: number }>(
    db,
    `INSERT INTO counters (name, value) VALUES ('booking_number', 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
  );
  if (row === null) throw new Error('booking number was not allocated');
  return Number(row.value);
}

export { nextBookingNumber };

interface LapsedHold {
  id: string;
  horse_id: string;
  owner_id: string;
}

/**
 * Records the lapse of every hold past its expiry. The entry belongs to the lapse, not
 * to the request that happened to record it, so it carries a system actor and is
 * written once.
 */
async function recordLapses(db: PoolClient, day: BarnDayRow, at: Date): Promise<void> {
  const lapsed = await query<LapsedHold>(
    db,
    `UPDATE bookings SET status = 'lapsed', lapse_recorded = true
     WHERE barn_day_id = $1 AND status = 'held' AND hold_expires_at <= $2
     RETURNING id, horse_id, owner_id`,
    [day.id, at],
  );
  for (const hold of lapsed) {
    await writeAudit(db, {
      actor: systemActor,
      action: 'lapse',
      entityType: 'booking',
      entityId: hold.id,
      from: 'held',
      to: 'lapsed',
      at,
      requestId: null,
    });
    const payment = await queryOne<{ id: string; status: string }>(
      db,
      `SELECT id, status FROM payments WHERE booking_id = $1 AND kind = 'deposit' AND status = 'authorized'`,
      [hold.id],
    );
    if (payment !== null) {
      await query(db, `UPDATE payments SET status = 'voided' WHERE id = $1`, [payment.id]);
      await writeAudit(db, {
        actor: systemActor,
        action: 'void',
        entityType: 'payment',
        entityId: payment.id,
        from: 'authorized',
        to: 'voided',
        at,
        requestId: null,
      });
    }
  }
}

interface WaitlistCandidate {
  id: string;
  horse_id: string;
  owner_id: string;
  position: number;
  horse_name: string;
  owner_email: string;
  owner_name: string;
  card_token: string | null;
}

async function closeUpPositions(db: PoolClient, barnDayId: string): Promise<void> {
  await query(
    db,
    `UPDATE waitlist_entries w SET position = ranked.rank
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, joined_at) AS rank
       FROM waitlist_entries WHERE barn_day_id = $1
     ) AS ranked
     WHERE w.id = ranked.id AND w.position <> ranked.rank`,
    [barnDayId],
  );
}

export async function blockedOwnerIds(db: Db): Promise<Set<string>> {
  const rows = await query<{ owner_id: string }>(
    db,
    `SELECT DISTINCT owner_id FROM invoices WHERE dunning_state = 'blocked' AND status <> 'paid'`,
  );
  return new Set(rows.map((row) => row.owner_id));
}

/**
 * The offer pass: while a slot is free on a published day before its start, the
 * lowest-position horse whose owner is not blocked gets a timed hold on the earliest
 * open slot. A decline removes that entry and moves on to the next position.
 */
export async function runOfferPass(
  db: PoolClient,
  day: BarnDayRow,
  context: DayContext,
  at: Date,
): Promise<void> {
  if (day.status !== 'published') return;
  if (at.getTime() >= day.starts_at.getTime()) return;

  const { timeZone } = await practice(db);
  const depositCents = await depositForDate(db, day.business_date);
  const blocked = await blockedOwnerIds(db);

  for (;;) {
    const slots = await slotsWithState(db, day.id, at);
    const openSlot = slots.find((slot) => slot.booking_id === null);
    if (openSlot === undefined) return;

    const candidates = await query<WaitlistCandidate>(
      db,
      `SELECT w.id, w.horse_id, w.owner_id, w.position, h.name AS horse_name,
              u.email AS owner_email, u.name AS owner_name, u.card_token
       FROM waitlist_entries w
       JOIN horses h ON h.id = w.horse_id
       JOIN users u ON u.id = w.owner_id
       WHERE w.barn_day_id = $1
       ORDER BY w.position`,
      [day.id],
    );
    const candidate = candidates.find((entry) => !blocked.has(entry.owner_id));
    if (candidate === undefined) return;

    const emailContext = {
      horseName: candidate.horse_name,
      barnName: day.barn_name,
      businessDate: day.business_date,
      slotTime: openSlot.slot_time,
      cutoff: '',
    };

    // A declined card removes the entry and the pass moves on to the next position.
    if (depositCents > 0) {
      const token = candidate.card_token;
      const outcome = token === null ? { approved: false } : chargeCard(token);
      if (!outcome.approved) {
        await query(db, 'DELETE FROM waitlist_entries WHERE id = $1', [candidate.id]);
        await closeUpPositions(db, day.id);
        if (token !== null) {
          await authorisePayment(db, {
            kind: 'deposit',
            ownerId: candidate.owner_id,
            amountCents: depositCents,
            cardToken: token,
            actor: context.actor,
            requestId: context.requestId,
            at,
          });
        }
        const message = offerLapsedEmail(emailContext);
        const email = {
          to: candidate.owner_email,
          subject: message.subject,
          body: message.body,
          dedupeKey: `offer_declined:${candidate.id}`,
        };
        if (context.queueKind === 'request') await queueRequestEmail(db, email);
        else await queueBackgroundEmail(db, email);
        continue;
      }
    }

    const bookingId = newId();
    const number = await nextBookingNumber(db);
    const holdExpiresAt = plusSecondsCeil(at, config.waitlistOfferSeconds);
    await query(
      db,
      `INSERT INTO bookings (id, number, barn_day_id, slot_id, horse_id, owner_id, status,
                             is_offer, hold_expires_at, deposit_cents, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'held',true,$7,$8,$9)`,
      [
        bookingId,
        number,
        day.id,
        openSlot.id,
        candidate.horse_id,
        candidate.owner_id,
        holdExpiresAt,
        depositCents,
        at,
      ],
    );
    if (depositCents > 0 && candidate.card_token !== null) {
      await authorisePayment(db, {
        kind: 'deposit',
        ownerId: candidate.owner_id,
        bookingId,
        amountCents: depositCents,
        cardToken: candidate.card_token,
        actor: context.actor,
        requestId: context.requestId,
        at,
      });
    }
    await writeAudit(db, {
      actor: context.actor,
      action: 'offer',
      entityType: 'booking',
      entityId: bookingId,
      to: 'held',
      at,
      requestId: context.requestId,
    });
    await query(db, 'DELETE FROM waitlist_entries WHERE id = $1', [candidate.id]);
    await closeUpPositions(db, day.id);

    const message = waitlistOfferEmail(
      emailContext,
      wallTimeSecondsAt(holdExpiresAt, timeZone),
      timeZone,
    );
    const email = {
      to: candidate.owner_email,
      subject: message.subject,
      body: message.body,
      dedupeKey: `offer:${bookingId}`,
    };
    if (context.queueKind === 'request') await queueRequestEmail(db, email);
    else await queueBackgroundEmail(db, email);
  }
}

/**
 * Serialises a unit of work on one barn day: the day's row lock is taken, lapses are
 * recorded, the offer pass runs before and after the work, and a move between published
 * and full reaches every role's stream.
 */
export async function onBarnDay<T>(
  barnDayId: string,
  context: DayContext,
  work: DayWork<T>,
): Promise<T | null> {
  return await withTransaction(async (db) => {
    const at = now();
    const day = await loadBarnDay(db, barnDayId, true);
    if (day === null) return null;

    const before = await dayStatusNow(db, day, at);
    await recordLapses(db, day, at);
    await runOfferPass(db, day, context, at);

    const result = await work(db, day);

    const refreshed = await loadBarnDay(db, barnDayId);
    if (refreshed !== null && refreshed.status === 'published') {
      await runOfferPass(db, refreshed, context, at);
    }
    const after =
      refreshed === null
        ? before
        : await dayStatusNow(db, refreshed, at);
    if (after !== before) await announceDayStatus(db, barnDayId, after, at);

    return result;
  });
}

/**
 * Records lapses and runs the offer pass in their own transaction, so those writes
 * stand even when the claim that follows is refused: they belong to the lapse and to
 * the offer, not to the claim.
 */
export async function prepareDay(barnDayId: string, context: DayContext): Promise<boolean> {
  return await withTransaction(async (db) => {
    const at = now();
    const day = await loadBarnDay(db, barnDayId, true);
    if (day === null) return false;
    const before = await dayStatusNow(db, day, at);
    await recordLapses(db, day, at);
    const refreshed = await loadBarnDay(db, barnDayId);
    if (refreshed !== null) await runOfferPass(db, refreshed, context, at);
    const after = await dayStatusNow(db, day, at);
    if (after !== before) await announceDayStatus(db, barnDayId, after, at);
    return true;
  });
}

/** Emits the row events a booking change causes on each role's stream. */
export async function announceBookingChange(
  db: PoolClient,
  barnDayId: string,
  bookingId: string,
  kind: 'booking_added' | 'booking_removed' | 'booking_moved',
  at: Date,
  roles: readonly ('farrier' | 'apprentice' | 'barn_manager')[] = [
    'farrier',
    'apprentice',
    'barn_manager',
  ],
): Promise<void> {
  const source = await bookingRowSource(db, barnDayId, bookingId);
  if (source === null) return;
  for (const role of roles) {
    if (role === 'barn_manager') {
      const visible = visibleToBarnManager(source);
      // A row the manager cannot see is announced as removed rather than changed.
      const event = kind === 'booking_moved' && !visible ? 'booking_removed' : kind;
      if (!visible && event !== 'booking_removed') continue;
      await appendEvent(db, barnDayChannel(barnDayId, role), event, projectBookingRow(source, role), at);
      continue;
    }
    await appendEvent(db, barnDayChannel(barnDayId, role), kind, projectBookingRow(source, role), at);
  }
}

export async function dayBookedCount(db: Db, barnDayId: string, at: Date): Promise<number> {
  return await bookedCount(db, barnDayId, at);
}

export async function currentDayStatus(db: Db, day: BarnDayRow, at: Date): Promise<DayStatus> {
  return await dayStatusNow(db, day, at);
}

export async function voidHoldDeposit(
  db: PoolClient,
  bookingId: string,
  actor: Actor,
  requestId: string | null,
  at: Date,
): Promise<PaymentRow | null> {
  const payment = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM payments WHERE booking_id = $1 AND kind = 'deposit' AND status = 'authorized'`,
    [bookingId],
  );
  if (payment === null) return null;
  const row = await loadPayment(db, payment.id, true);
  if (row === null) return null;
  await voidPayment(db, row, actor, requestId, at);
  return await loadPayment(db, payment.id);
}
