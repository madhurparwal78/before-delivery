import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { query, withTransaction, withAdvisoryLock } from './database';
import type { Config } from '../config';
import type { KillBillClient, KbItem } from './killbill';
import type { OutboxService } from './outbox';
import { ApiError } from '../http/errors';
import {
  priceBreakdown, costSplit, refundDeadline,
  farePrices, fareOrder, tierPrices, tierRank,
  type Fare, type Tier, type Cadence, type Locale,
  type PriceBreakdown, type PayerShare,
} from '../domain/model';
import { seatSort } from '../domain/seats';
import { iso, dateOnly, timeOnly, torontoTz } from '../time';
import { holdId, bookingRef, ticketCode, sha256Hex, capabilityToken } from '../domain/ids';
import { bookingConfirmationEmail, emailText, emailHtml } from '../mail/templates';
import { formatAmount } from '../domain/i18n';

export interface HoldView {
  id: string;
  screening_id: string;
  seats: string[];
  group: boolean;
  state: 'held' | 'expired' | 'paid';
  ended_by: string | null;
  expires_at: string;
  server_time: string;
  booking_ref: string | null;
}

export interface QuoteView extends PriceBreakdown {
  credit_applied_cents: number;
  pay_now_cents: number;
  stepup_required: boolean;
}

export interface TicketView { code: string; seat: string; fare: Fare; status: string }

export interface BookingLineView {
  fare: Fare; quantity: number; unit_cents: number;
  subtotal_cents: number; gst_cents: number; qst_cents: number;
}

export interface BookingView {
  ref: string;
  state: string;
  locale: Locale;
  screening: { id: string; film_title: string; starts_at: string; auditorium: string };
  seats: string[];
  tickets: TicketView[];
  lines: BookingLineView[];
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
  credit_applied_cents: number;
  paid_cents: number;
  currency: 'CAD';
  split: PayerShare[] | null;
  paid_at: string | null;
}

export interface HoldRow {
  id: string;
  screening_id: string;
  group_booking: boolean;
  state: string;
  ended_by: string | null;
  expires_at: Date;
  booking_ref: string | null;
  account_id: number | null;
  session_token: string;
  last_quote: unknown;
}

function holdView(row: HoldRow, seats: string[]): HoldView {
  const expires = DateTime.fromJSDate(row.expires_at);
  return {
    id: row.id,
    screening_id: row.screening_id,
    seats: seatSort(seats),
    group: row.group_booking,
    state: row.state as 'held' | 'expired' | 'paid',
    ended_by: row.ended_by,
    expires_at: iso(expires),
    server_time: iso(DateTime.now()),
    booking_ref: row.booking_ref,
  };
}

export async function getHoldRaw(holdUuid: string): Promise<{ row: HoldRow; seats: string[] } | null> {
  const res = await query<HoldRow>(
    `SELECT id, screening_id, group_booking, state, ended_by, expires_at, booking_ref, account_id, session_token, last_quote
     FROM holds WHERE id = $1`,
    [holdUuid],
  );
  const row = res.rows[0];
  if (!row) return null;
  const seats = await query<{ seat: string }>(
    `SELECT seat FROM hold_seats WHERE hold_id=$1 ORDER BY substring(seat from 1 for 1), substring(seat from 2)::int`,
    [holdUuid],
  );
  return { row, seats: seats.rows.map(s => s.seat) };
}

/** The ownership rule: a hold that is not the caller's answers exactly like a missing one. */
export function assertHoldOwnership(
  found: { row: HoldRow; seats: string[] } | null,
  sessionToken: string | null,
  accountId: number | null,
): { row: HoldRow; seats: string[] } {
  if (!found) throw new ApiError('not_found');
  const sessionMatches = found.row.session_token === sessionToken;
  const accountMatches = found.row.account_id === null || found.row.account_id === accountId;
  if (!sessionMatches || !accountMatches) throw new ApiError('not_found');
  return found;
}

/** The one hold-liveness rule: live while server time is strictly before expires_at. */
export async function expireHoldIfNeeded(row: HoldRow): Promise<HoldRow> {
  if (row.state === 'held' && DateTime.fromJSDate(row.expires_at) <= DateTime.now()) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE holds SET state='expired', ended_by='timeout' WHERE id=$1 AND state='held'`,
        [row.id],
      );
      await client.query('DELETE FROM seat_claims WHERE hold_id=$1', [row.id]);
    });
    return { ...row, state: 'expired', ended_by: 'timeout' };
  }
  return row;
}

function hashLockKey(screeningId: string): number {
  let hash = 0;
  for (const ch of screeningId) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

/**
 * The one seat-claim rule: claims are decided in the database, one winner per
 * seat. Losers get seat_taken and the transaction rolls back whole.
 */
async function claimSeats(
  client: PoolClient,
  screeningId: string,
  seats: string[],
  holdUuid: string,
): Promise<void> {
  const taken: string[] = [];
  for (const seat of seatSort(seats)) {
    const insert = await client.query(
      `INSERT INTO seat_claims (screening_id, seat, hold_id) VALUES ($1,$2,$3)
       ON CONFLICT (screening_id, seat) DO NOTHING`,
      [screeningId, seat, holdUuid],
    );
    if (insert.rowCount !== 0) continue;
    const existing = await client.query<{ hold_id: string | null; booking_ref: string | null }>(
      `SELECT hold_id, booking_ref FROM seat_claims WHERE screening_id=$1 AND seat=$2 FOR UPDATE`,
      [screeningId, seat],
    );
    const claim = existing.rows[0];
    if (claim?.booking_ref) {
      taken.push(seat);
      continue;
    }
    const claimedHold = claim?.hold_id ?? null;
    let reclaimed = false;
    if (claimedHold) {
      const holder = await client.query<{ state: string; expires_at: Date }>(
        `SELECT state, expires_at FROM holds WHERE id=$1 FOR UPDATE`,
        [claimedHold],
      );
      const h = holder.rows[0];
      const live = h && h.state === 'held' && DateTime.fromJSDate(h.expires_at) > DateTime.now();
      if (!live) {
        await client.query(
          `UPDATE seat_claims SET hold_id=$3, claimed_at=now() WHERE screening_id=$1 AND seat=$2`,
          [screeningId, seat, holdUuid],
        );
        reclaimed = true;
      }
    }
    if (!reclaimed) taken.push(seat);
  }
  if (taken.length > 0) {
    throw new ApiError('seat_taken', {
      params: { seats: taken.join(', ') },
      extra: { seats: taken },
    });
  }
}

export interface CreateHoldInput {
  screeningId: string;
  seats: string[];
  group: boolean;
  sessionToken: string;
  accountId: number | null;
  isMember: boolean;
  holdTtlSeconds: number;
  seasonState: string;
  seasonPublicSaleDate: string;
  screeningStartsAt: DateTime;
  auditoriumSeats: string[];
}

export async function createHold(input: CreateHoldInput): Promise<HoldView> {
  const { group } = input;
  const count = input.seats.length;
  if (group && (count < 10 || count > 40)) {
    throw new ApiError('validation', { fields: { seats: 'Choose 10 to 40 seats for a group.' } });
  }
  if (!group && (count < 1 || count > 10)) {
    throw new ApiError('validation', { fields: { seats: 'Choose 1 to 10 seats.' } });
  }
  const unique = new Set(input.seats);
  const seatMsg = group ? 'Choose 10 to 40 seats for a group.' : 'Choose 1 to 10 seats.';
  if (unique.size !== count || !input.seats.every(s => input.auditoriumSeats.includes(s))) {
    throw new ApiError('validation', { fields: { seats: seatMsg } });
  }
  if (group && input.accountId === null) {
    throw new ApiError('unauthenticated');
  }

  // The one place that decides who may hold, per the season's live state.
  if (input.seasonState === 'draft') throw new ApiError('not_found');
  if (input.seasonState === 'archived' || input.seasonState === 'withdrawn') {
    throw new ApiError('screening_closed');
  }
  if (DateTime.now() >= input.screeningStartsAt) {
    throw new ApiError('screening_closed');
  }
  const priorityOpens = DateTime.fromISO(`${input.seasonPublicSaleDate}T10:00:00`, { zone: torontoTz }).minus({ days: 3 });
  const publicOpens = DateTime.fromISO(`${input.seasonPublicSaleDate}T10:00:00`, { zone: torontoTz });
  const now = DateTime.now();
  if (now < priorityOpens) {
    throw new ApiError('not_on_sale', { params: { date: dateOnly(priorityOpens) } });
  }
  if (now < publicOpens && !input.isMember) {
    throw new ApiError('members_priority', { params: { date: dateOnly(publicOpens) } });
  }

  const uuid = holdId();
  const expires = DateTime.now().plus({ seconds: input.holdTtlSeconds });

  return withAdvisoryLock(hashLockKey(input.screeningId), async (client) => {
    await client.query(
      `INSERT INTO holds (id, session_token, account_id, screening_id, group_booking, state, expires_at)
       VALUES ($1,$2,$3,$4,$5,'held',$6)`,
      [uuid, input.sessionToken, input.accountId, input.screeningId, group, expires.toJSDate()],
    );
    for (const seat of seatSort(input.seats)) {
      await client.query('INSERT INTO hold_seats (hold_id, seat) VALUES ($1,$2)', [uuid, seat]);
    }
    await claimSeats(client, input.screeningId, input.seats, uuid);
    return holdView(
      {
        id: uuid, screening_id: input.screeningId, group_booking: group, state: 'held',
        ended_by: null, expires_at: expires.toJSDate(), booking_ref: null,
        account_id: input.accountId, session_token: input.sessionToken, last_quote: null,
      },
      input.seats,
    );
  });
}

export async function releaseHold(holdUuid: string): Promise<HoldView> {
  const found = await getHoldRaw(holdUuid);
  if (!found) throw new ApiError('not_found');
  const row = await expireHoldIfNeeded(found.row);
  if (row.state === 'expired') throw new ApiError('hold_expired');
  if (row.state === 'paid') throw new ApiError('hold_already_paid');
  const lastQuote = row.last_quote as { total_cents?: number } | null;
  const released = lastQuote?.total_cents ?? 0;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE holds SET state='expired', ended_by='patron' WHERE id=$1 AND state='held'`,
      [holdUuid],
    );
    await client.query('DELETE FROM seat_claims WHERE hold_id=$1', [holdUuid]);
  });
  return holdView({ ...row, state: 'expired', ended_by: 'patron' }, found.seats);
}

export { holdView, claimSeats };
