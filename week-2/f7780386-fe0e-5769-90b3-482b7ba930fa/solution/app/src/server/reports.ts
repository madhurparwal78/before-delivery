// Operator reports: daily usage totals and the monthly usage CSV, both by kitchen-local booking date.

import type { BookingStatus, Payment, Usage } from "../shared/api.js";
import { clock, formatHours, formatMoney } from "../shared/rules.js";
import { addDays, isCalendarDate } from "../shared/zone.js";
import { tx } from "./db.js";
import { forbidden, invalid } from "./errors.js";
import { json, type Reply, type Request } from "./http.js";
import { stationOf, stations, timeZone, today } from "./kitchen.js";
import type { SessionUser } from "./sessions.js";

function requireOperator(user: SessionUser): void {
  if (user.role !== "operator") throw forbidden();
}

export async function dailyUsage(req: Request, user: SessionUser): Promise<Reply> {
  requireOperator(user);
  const date = req.query.get("date") ?? today();
  if (!isCalendarDate(date)) throw invalid({ date: "invalid" });
  const totals = await tx((db) =>
    db.query<{ station_id: string; booked: number; cleaning: number; count: number }>(
      `SELECT station_id, SUM(end_minute - start_minute)::int AS booked, SUM(tail_end_minute - end_minute)::int AS cleaning, COUNT(*)::int AS count
         FROM bookings WHERE date = $1 AND status IN ('confirmed', 'checked_in', 'completed') GROUP BY station_id`,
      [date],
    ),
  );
  const usage: Usage = {
    date,
    time_zone: timeZone(),
    stations: stations().map((s) => {
      const row = totals.rows.find((t) => t.station_id === s.id);
      return { station_id: s.id, station_name: s.name, booked_minutes: row?.booked ?? 0, cleaning_minutes: row?.cleaning ?? 0, bookings: row?.count ?? 0 };
    }),
    total_booked_minutes: totals.rows.reduce((sum, row) => sum + row.booked, 0),
  };
  return json(200, usage);
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: a leading = + - @ tab or CR gets an apostrophe, then RFC 4180 quoting. */
function csvCell(value: string): string {
  const neutral = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutral) ? `"${neutral.replaceAll('"', '""')}"` : neutral;
}

const CSV_HEADER = ["date", "station", "business", "start", "end", "cleaning_until", "booked_hours", "prepaid_hours", "overage_hours", "overage_amount", "status", "payment"];

export async function usageCsv(req: Request, user: SessionUser): Promise<Reply> {
  requireOperator(user);
  const month = req.query.get("month") ?? today().slice(0, 7);
  const first = `${month}-01`;
  if (!/^\d{4}-\d{2}$/.test(month) || !isCalendarDate(first)) throw invalid({ month: "invalid" });
  const last = addDays(addDays(first, 31).slice(0, 7) + "-01", -1);
  const rows = await tx((db) =>
    db.query<{
      date: string;
      station_id: string;
      business_name: string;
      start_minute: number;
      end_minute: number;
      tail_end_minute: number;
      booked_minutes: number;
      prepaid_minutes: number;
      overage_minutes: number;
      overage_cents: number;
      status: BookingStatus;
      payment: Payment;
    }>(
      `SELECT b.date, b.station_id, m.business_name, b.start_minute, b.end_minute, b.tail_end_minute, b.booked_minutes,
              b.prepaid_minutes, b.overage_minutes, b.overage_cents, b.status, b.payment
         FROM bookings b JOIN members m ON m.id = b.member_id
        WHERE b.date BETWEEN $1 AND $2`,
      [first, last],
    ),
  );
  const lines = rows.rows
    .map((r) => ({ r, station: stationOf(r.station_id).name }))
    .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.r.start_minute - b.r.start_minute || a.station.localeCompare(b.station))
    .map(({ r, station }) =>
      [
        r.date,
        station,
        r.business_name,
        clock(r.start_minute),
        clock(r.end_minute),
        clock(r.tail_end_minute),
        formatHours(r.booked_minutes),
        formatHours(r.prepaid_minutes),
        formatHours(r.overage_minutes),
        formatMoney(r.overage_cents),
        r.status,
        r.payment,
      ]
        .map(csvCell)
        .join(","),
    );
  const body = [CSV_HEADER.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
  return {
    status: 200,
    bytes: Buffer.from(body, "utf8"),
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="passboard-usage-${month}.csv"` },
  };
}
