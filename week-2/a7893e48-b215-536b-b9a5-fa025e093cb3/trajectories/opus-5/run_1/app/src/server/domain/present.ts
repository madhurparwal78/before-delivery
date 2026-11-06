import type { Booking, Hold, Invoice, InvoiceLine } from '../../shared/types.js';
import type { Db } from '../db/pool.js';
import { formatHours, termsLine } from './format.js';
import { packBalances } from './pack.js';
import { quoteFor } from './pricing.js';
import { occurrencesOf, type BookingRow, type HoldRow, type OccurrenceRow } from './records.js';
import { ACTIVE_BOOKING_STATUSES } from './transitions.js';
import { localStamp } from './zone.js';

export function bookingIsPaid(row: BookingRow): boolean {
  return row.card_minutes === 0 || row.time_paid;
}

export function balanceDueCents(row: BookingRow): number {
  if (!ACTIVE_BOOKING_STATUSES.includes(row.status)) return 0;
  return bookingIsPaid(row) ? 0 : row.card_cents;
}

export function presentBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    hold_id: row.hold_id,
    site_id: row.site_id,
    station_id: row.station_id,
    station_name: row.station_name,
    renter_id: row.renter_id,
    renter_business: row.renter_business,
    status: row.status,
    start_at: row.start_at.toISOString(),
    end_at: row.end_at.toISOString(),
    local_start: localStamp(row.time_zone, row.start_at),
    local_end: localStamp(row.time_zone, row.end_at),
    minutes: row.minutes,
    pack_minutes: row.pack_minutes,
    card_minutes: row.card_minutes,
    card_cents: row.card_cents,
    deposit_cents: row.deposit_cents,
    paid: bookingIsPaid(row),
    balance_due_cents: balanceDueCents(row),
    balance_due_by: row.balance_due_by === null ? null : row.balance_due_by.toISOString(),
    policy: {
      version_id: row.policy_version_id,
      notice_hours: row.notice_hours,
      effective_from: row.effective_from,
    },
    confirmed_at: row.confirmed_at.toISOString(),
    checked_in_at: row.checked_in_at === null ? null : row.checked_in_at.toISOString(),
    checked_out_at: row.checked_out_at === null ? null : row.checked_out_at.toISOString(),
    overrun_minutes: row.overrun_minutes,
    overrun_cents: row.overrun_cents,
    cleaning_fee_cents: row.cleaning_fee_cents,
    terms: termsLine(row.notice_hours),
  };
}

export function presentInvoice(row: BookingRow): Invoice {
  const lines: InvoiceLine[] = [];
  if (row.card_minutes > 0) {
    lines.push({
      description: `${row.station_name} station time (card)`,
      minutes: row.card_minutes,
      amount_cents: row.card_cents,
    });
  }
  if (row.pack_minutes > 0) {
    lines.push({
      description: `${row.station_name} station time (pack ${formatHours(row.pack_minutes)} h)`,
      minutes: row.pack_minutes,
      amount_cents: 0,
    });
  }
  if (row.deposit_cents > 0) {
    lines.push({ description: 'Damage deposit', minutes: null, amount_cents: row.deposit_cents });
  }
  if (row.overrun_minutes > 0) {
    lines.push({
      description: 'Overrun',
      minutes: row.overrun_minutes,
      amount_cents: row.overrun_cents,
    });
  }
  if (row.cleaning_fee_cents > 0) {
    lines.push({ description: 'Cleaning fee', minutes: null, amount_cents: row.cleaning_fee_cents });
  }
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  const paid =
    (row.time_paid ? row.card_cents : 0) +
    row.deposit_cents +
    row.overrun_cents +
    row.cleaning_fee_cents;
  return {
    booking_id: row.id,
    renter_business: row.renter_business,
    site_name: row.site_name,
    lines,
    total_cents: total,
    paid_cents: paid,
    refunded_cents: row.card_refund_cents + row.deposit_refund_cents,
    balance_due_cents: balanceDueCents(row),
    terms: termsLine(row.notice_hours),
  };
}

export async function presentHold(
  db: Db,
  row: HoldRow,
  occurrences?: readonly OccurrenceRow[],
): Promise<Hold> {
  const list = occurrences ?? (await occurrencesOf(db, row.id));
  const balances = await packBalances(db, row.renter_id);
  const quote = quoteFor(
    balances.availableMinutes,
    list.map((entry) => entry.minutes),
    row.rate_cents,
    row.deposit_cents,
  );
  return {
    id: row.id,
    status: row.status,
    station_id: row.station_id,
    site_id: row.site_id,
    renter_id: row.renter_id,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    occurrences: list.map((entry) => ({
      date: entry.local_date,
      start: entry.local_start,
      end: entry.local_end,
      start_at: entry.start_at.toISOString(),
      end_at: entry.end_at.toISOString(),
      minutes: entry.minutes,
    })),
    quote,
  };
}
