import type { UsageResponse } from '../../shared/api.js';
import { csvRow } from '../../shared/domain.js';
import { formatHours, formatMoney } from '../../shared/format.js';
import { formatClock } from '../../shared/time.js';
import { ACTIVE_BOOKING_STATUSES } from './bookings.js';
import { listStations, type Queryable } from './kitchen.js';

/** Daily totals count bookings assigned to their kitchen-local date. */
export async function dailyUsage(
  db: Queryable,
  date: string,
  timeZone: string,
): Promise<UsageResponse> {
  const stations = await listStations(db);
  const result = await db.query<{
    station_id: string;
    booked_minutes: number;
    cleaning_minutes: number;
    bookings: number;
  }>(
    `SELECT station_id,
            COALESCE(SUM(end_minutes - start_minutes), 0)::int AS booked_minutes,
            COALESCE(SUM(tail_end_minutes - end_minutes), 0)::int AS cleaning_minutes,
            COUNT(*)::int AS bookings
       FROM bookings
      WHERE kitchen_date = $1 AND status = ANY($2::text[])
      GROUP BY station_id`,
    [date, ACTIVE_BOOKING_STATUSES as readonly string[]],
  );
  const byStation = new Map(result.rows.map((row) => [row.station_id, row]));

  const rows = stations.map((station) => {
    const found = byStation.get(station.id);
    return {
      station_id: station.id,
      station_name: station.name,
      booked_minutes: found?.booked_minutes ?? 0,
      cleaning_minutes: found?.cleaning_minutes ?? 0,
      bookings: found?.bookings ?? 0,
    };
  });

  return {
    date,
    time_zone: timeZone,
    stations: rows,
    total_booked_minutes: rows.reduce((total, row) => total + row.booked_minutes, 0),
  };
}

const CSV_HEADER = [
  'date',
  'station',
  'business',
  'start',
  'end',
  'cleaning_until',
  'booked_hours',
  'prepaid_hours',
  'overage_hours',
  'overage_amount',
  'status',
  'payment',
] as const;

interface ExportRow {
  kitchen_date: string;
  station_name: string;
  business_name: string;
  start_minutes: number;
  end_minutes: number;
  tail_end_minutes: number;
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_cents: number;
  status: string;
  payment: string;
}

/** One row per booking of any status whose kitchen date falls in the month. */
export async function monthlyUsageCsv(db: Queryable, month: string): Promise<string> {
  const from = `${month}-01`;
  const result = await db.query<ExportRow>(
    `SELECT b.kitchen_date, s.name AS station_name, m.business_name, b.start_minutes,
            b.end_minutes, b.tail_end_minutes, b.booked_minutes, b.prepaid_minutes,
            b.overage_minutes, b.overage_cents, b.status, b.payment
       FROM bookings b
       JOIN stations s ON s.id = b.station_id
       JOIN members m ON m.id = b.member_id
      WHERE b.kitchen_date >= $1::date
        AND b.kitchen_date < ($1::date + INTERVAL '1 month')
      ORDER BY b.kitchen_date, b.start_minutes, s.name`,
    [from],
  );

  const lines = [csvRow(CSV_HEADER)];
  for (const row of result.rows) {
    lines.push(
      csvRow([
        row.kitchen_date,
        row.station_name,
        row.business_name,
        formatClock(row.start_minutes),
        formatClock(row.end_minutes),
        formatClock(row.tail_end_minutes),
        formatHours(row.booked_minutes),
        formatHours(row.prepaid_minutes),
        formatHours(row.overage_minutes),
        formatMoney(row.overage_cents),
        row.status,
        row.payment,
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
