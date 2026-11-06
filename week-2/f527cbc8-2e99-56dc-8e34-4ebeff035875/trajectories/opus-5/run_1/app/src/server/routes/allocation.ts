import type { PoolClient } from 'pg';
import { query, type Db } from '../db.js';
import type { Ctx } from '../http.js';
import { callerActor } from '../auth.js';
import { formatInstant } from '../domain/time.js';
import { practice } from '../domain/practice.js';
import type { BarnDayRow } from '../domain/barndays.js';
import {
  createInvoiceRow,
  depositCreditCents,
  depositCreditDescription,
  grossOf,
  tripOnlyDescription,
  type InvoiceItem,
} from '../domain/invoicing.js';
import { depositPaymentForBooking } from '../domain/payments.js';

/**
 * The allocation a barn day carries: the share fixed at start for each counting horse,
 * the share it carries now, and every appended adjustment in order.
 */
interface ShareRow {
  booking_id: string;
  number: number;
  horse_id: string;
  horse_name: string;
  status: string;
  initial_cents: number | null;
  share_cents: number | null;
}

interface AdjustmentRow {
  seq: number;
  booking_id: string;
  number: number;
  delta_cents: number;
  cause_booking_id: string;
  at: Date;
}

export async function allocationBody(db: Db, day: BarnDayRow): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const shares = await query<ShareRow>(
    db,
    `SELECT bk.id AS booking_id, bk.number::int AS number, h.id AS horse_id, h.name AS horse_name,
            bk.status, bk.initial_share_cents AS initial_cents, bk.share_cents
     FROM bookings bk JOIN horses h ON h.id = bk.horse_id
     WHERE bk.barn_day_id = $1 AND bk.counts_for_trip = true
     ORDER BY bk.number`,
    [day.id],
  );
  const adjustments = await query<AdjustmentRow>(
    db,
    `SELECT a.seq, a.booking_id, bk.number::int AS number, a.delta_cents, a.cause_booking_id, a.at
     FROM trip_share_adjustments a JOIN bookings bk ON bk.id = a.booking_id
     WHERE a.barn_day_id = $1 ORDER BY a.seq`,
    [day.id],
  );
  return {
    barn_day_id: day.id,
    trip_fee_cents: day.trip_fee_cents,
    shares: shares.map((row) => ({
      booking_id: row.booking_id,
      number: row.number,
      horse: { id: row.horse_id, name: row.horse_name },
      status: row.status,
      initial_cents: row.initial_cents,
      share_cents: row.share_cents,
    })),
    adjustments: adjustments.map((row) => ({
      seq: row.seq,
      booking_id: row.booking_id,
      number: row.number,
      delta_cents: row.delta_cents,
      cause_booking_id: row.cause_booking_id,
      at: formatInstant(row.at, timeZone),
    })),
  };
}

interface TripOnlyCandidate {
  booking_id: string;
  owner_id: string;
  horse_id: string;
  horse_name: string;
  status: 'cancelled_late' | 'no_show';
  share_cents: number;
}

/**
 * Closing a day gives every late-cancelled or no-show horse with a non-zero share
 * exactly one trip-only invoice, with any kept deposit credited up to the share.
 * The invoice rows are written here; their Kill Bill legs are pushed after the
 * day's transaction commits.
 */
export async function closeDayTripInvoices(
  db: PoolClient,
  day: BarnDayRow,
  ctx: Ctx,
  at: Date,
): Promise<string[]> {
  const candidates = await query<TripOnlyCandidate>(
    db,
    `SELECT bk.id AS booking_id, bk.owner_id, h.id AS horse_id, h.name AS horse_name,
            bk.status, bk.share_cents
     FROM bookings bk JOIN horses h ON h.id = bk.horse_id
     WHERE bk.barn_day_id = $1 AND bk.status IN ('cancelled_late','no_show')
       AND COALESCE(bk.share_cents,0) > 0
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.booking_id = bk.id AND i.kind = 'trip')
     ORDER BY bk.number`,
    [day.id],
  );

  const created: string[] = [];
  for (const candidate of candidates) {
    const items: InvoiceItem[] = [
      {
        description: tripOnlyDescription(
          day.barn_name,
          day.business_date,
          candidate.horse_name,
          candidate.status === 'cancelled_late' ? 'cancelled late' : 'no-show',
        ),
        amount_cents: candidate.share_cents,
      },
    ];
    const deposit = await depositPaymentForBooking(db, candidate.booking_id);
    const credit = depositCreditCents(deposit, grossOf(items));
    if (credit > 0) {
      items.push({
        description: depositCreditDescription(candidate.horse_name, day.business_date),
        amount_cents: -credit,
      });
    }
    const invoice = await createInvoiceRow(db, {
      kind: 'trip',
      ownerId: candidate.owner_id,
      horseId: candidate.horse_id,
      visitId: null,
      bookingId: candidate.booking_id,
      barnDayId: day.id,
      businessDate: day.business_date,
      items,
      actor: callerActor(ctx.caller),
      requestId: ctx.requestId,
      at,
    });
    created.push(invoice.id);
  }
  return created;
}
