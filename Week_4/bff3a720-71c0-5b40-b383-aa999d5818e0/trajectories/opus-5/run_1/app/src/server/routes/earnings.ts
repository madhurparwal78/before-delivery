import { db } from '../db.js';
import { errors } from '../errors.js';
import { plainAmount } from '../../shared/format.js';
import { parseMonth, zonedStamp } from '../domain/time.js';
import { bookingAmounts, boardingTimeOf, loadRide } from '../model.js';
import type { Ctx, Reply, Router } from '../http.js';

interface EarningsRow {
  booking_id: string;
  departure: string;
  from: string;
  to: string;
  passenger: string;
  seats: number;
  paid_cents: number;
  refunded_cents: number;
  earned_cents: number;
  status: string;
  sortAt: number;
}

/** One row per booking ever confirmed on a ride departing in the chosen month. */
async function earningsRows(ctx: Ctx): Promise<{ month: string; rows: EarningsRow[] }> {
  const member = ctx.requireMember();
  if (!member.roles.includes('driver')) throw errors.forbidden();
  const month = ctx.query('month') ?? '';
  const range = parseMonth(month);
  if (!range) throw errors.validationFailed({ month: 'Choose a month like 2026-11.' });

  const { rows } = await db.query<{
    id: string;
    ride_id: string;
    boarding_idx: number;
    alighting_idx: number;
    seats: number;
    state: string;
    display_name: string;
  }>(
    `select b.id, b.ride_id, b.boarding_idx, b.alighting_idx, b.seats, b.state, m.display_name
       from bookings b
       join rides r on r.id = b.ride_id
       join members m on m.id = b.passenger_id
      where r.driver_id = $1 and r.departure >= $2 and r.departure < $3
        and exists (select 1 from booking_history h
                     where h.booking_id = b.id and h.state = 'confirmed')
      order by b.id`,
    [member.id, range.start, range.end],
  );

  const result: EarningsRow[] = [];
  for (const row of rows) {
    const ride = await loadRide(db, row.ride_id);
    if (!ride) continue;
    const amounts = await bookingAmounts(db, row.id);
    const boardingAt = boardingTimeOf(ride, row.boarding_idx);
    result.push({
      booking_id: row.id,
      departure: zonedStamp(boardingAt),
      from: ride.stops[row.boarding_idx]?.city ?? '',
      to: ride.stops[row.alighting_idx]?.city ?? '',
      passenger: row.display_name,
      seats: row.seats,
      paid_cents: amounts.paid_cents,
      refunded_cents: amounts.refunded_cents,
      earned_cents: amounts.earned_cents,
      status: row.state,
      sortAt: boardingAt.getTime(),
    });
  }
  result.sort((a, b) =>
    a.sortAt === b.sortAt ? a.booking_id.localeCompare(b.booking_id) : a.sortAt - b.sortAt,
  );
  return { month, rows: result };
}

async function json(ctx: Ctx): Promise<Reply> {
  const { month, rows } = await earningsRows(ctx);
  return {
    status: 200,
    body: {
      month,
      rows: rows.map(({ sortAt, ...rest }) => {
        void sortAt;
        return rest;
      }),
      total_earned_cents: rows.reduce((sum, row) => sum + row.earned_cents, 0),
    },
  };
}

const CSV_HEADER = 'booking_id,departure,from,to,passenger,seats,paid,refunded,earned,status';

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function csv(ctx: Ctx): Promise<Reply> {
  const { month, rows } = await earningsRows(ctx);
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.booking_id,
        row.departure,
        row.from,
        row.to,
        row.passenger,
        String(row.seats),
        plainAmount(row.paid_cents),
        plainAmount(row.refunded_cents),
        plainAmount(row.earned_cents),
        row.status,
      ]
        .map(csvField)
        .join(','),
    );
  }
  return {
    status: 200,
    raw: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'Content-Disposition': `attachment; filename="longseat-earnings-${month}.csv"`,
    },
  };
}

export function registerEarningsRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/driver/earnings',
    kind: 'plain',
    auth: 'member',
    handler: json,
  });
  router.add({
    method: 'GET',
    pattern: '/api/driver/earnings.csv',
    kind: 'plain',
    auth: 'member',
    handler: csv,
  });
}
