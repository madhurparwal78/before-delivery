/** The usage CSV: its rows, its numeric cells and its text-cell neutralisation. */
import { moneyPlain } from '../../shared/format.js';
import type { BillingItem, BookingRow, Station } from '../domain/types.js';

const header =
  'booking_id,member_id,business_name,station,date,start,end,hours,peak_hours,shelf_days,' +
  'status,charge,penalty,billing_status,hour_bank_balance,notes';

const countedStatuses = new Set(['confirmed', 'checked_in', 'completed', 'no_show']);

function escapeCell(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A text cell that could run as a formula is prefixed with a single apostrophe. */
function textCell(value: string): string {
  const first = value.charAt(0);
  const dangerous = first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r';
  return escapeCell(dangerous ? `'${value}` : value);
}

function numericCell(value: string): string {
  return value;
}

export type AdjustmentRow = { item: BillingItem; stationName: string };

export type UsageRowInput = {
  bookings: BookingRow[];
  adjustments: AdjustmentRow[];
  stations: Map<string, Station>;
  businessNames: Map<string, string>;
  balanceHours: Map<string, number>;
  pendingBookingIds: Set<string>;
  pendingItemIds: Set<string>;
};

export function usageCsv(input: UsageRowInput): string {
  const rows: string[] = [header];
  for (const booking of input.bookings) {
    const counted = countedStatuses.has(booking.status);
    const station = input.stations.get(booking.stationId);
    rows.push(
      [
        textCell(booking.id),
        textCell(booking.memberId),
        textCell(input.businessNames.get(booking.memberId) ?? ''),
        textCell(station?.name ?? ''),
        textCell(booking.localDate),
        textCell(booking.kind === 'shelf' ? '' : booking.localStart ?? ''),
        textCell(booking.kind === 'shelf' ? '' : booking.localEnd ?? ''),
        numericCell(String(booking.quarterHours / 4)),
        numericCell(String(booking.peakQuarters / 4)),
        numericCell(String(booking.kind === 'shelf' ? booking.days ?? 0 : 0)),
        textCell(booking.status),
        numericCell(moneyPlain(counted ? booking.chargeCents : 0)),
        numericCell(moneyPlain(booking.penaltyWaived ? 0 : booking.penaltyCents)),
        textCell(
          booking.confirmedAtMs === null
            ? 'not_billed'
            : input.pendingBookingIds.has(booking.id)
              ? 'pending_billing'
              : 'billed',
        ),
        numericCell(String(input.balanceHours.get(booking.memberId) ?? 0)),
        textCell(booking.notes),
      ].join(','),
    );
  }
  for (const { item, stationName } of input.adjustments) {
    rows.push(
      [
        textCell(item.bookingId),
        textCell(item.memberId),
        textCell(input.businessNames.get(item.memberId) ?? ''),
        textCell(stationName),
        textCell(item.filedDate),
        '',
        '',
        numericCell('0'),
        numericCell('0'),
        numericCell('0'),
        textCell('adjustment'),
        numericCell(moneyPlain(item.amountCents)),
        numericCell('0.00'),
        textCell(input.pendingItemIds.has(item.id) ? 'pending_billing' : 'billed'),
        numericCell(String(input.balanceHours.get(item.memberId) ?? 0)),
        '',
      ].join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

export const usageCsvHeader = header;
