import type { Earnings, EarningsRow } from "../../shared/api";
import { brusselsInstant, dateKey, hhmm, isoBrussels } from "../../shared/time";
import type { Db } from "../db";
import { bookingMoney } from "./ledger";
import { boardingTimeOf, loadRide, type BookingRow } from "./views";

export const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** One row per booking ever confirmed on a ride departing in the month, in Europe/Brussels. */
export async function earningsFor(db: Db, driverId: string, month: string): Promise<Earnings> {
  const match = MONTH_PATTERN.exec(month) as RegExpExecArray;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const start = brusselsInstant(year, monthNumber, 1, 0, 0);
  const end = monthNumber === 12 ? brusselsInstant(year + 1, 1, 1, 0, 0) : brusselsInstant(year, monthNumber + 1, 1, 0, 0);
  const { rows } = await db.query<BookingRow & { passenger_name: string }>(
    `SELECT b.*, m.display_name AS passenger_name
       FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN members m ON m.id = b.passenger_id
      WHERE r.driver_id = $1 AND r.departure >= $2 AND r.departure < $3
        AND EXISTS (SELECT 1 FROM booking_history h WHERE h.booking_id = b.id AND h.state = 'confirmed')`,
    [driverId, start, end],
  );
  const built: { row: EarningsRow; boarding: Date }[] = [];
  for (const booking of rows) {
    const ride = await loadRide(db, booking.ride_id);
    if (!ride) continue;
    const boarding = boardingTimeOf(ride, booking);
    const money = await bookingMoney(db, booking.id);
    built.push({
      boarding,
      row: {
        booking_id: booking.id,
        departure: isoBrussels(boarding),
        from: ride.route.cities[booking.boarding_index] as string,
        to: ride.route.cities[booking.alighting_index] as string,
        passenger: booking.passenger_name,
        seats: booking.seats,
        paid_cents: money.paid_cents,
        refunded_cents: money.refunded_cents,
        earned_cents: money.earned_cents,
        status: booking.state,
      },
    });
  }
  built.sort((a, b) => a.boarding.getTime() - b.boarding.getTime() || a.row.booking_id.localeCompare(b.row.booking_id));
  const list = built.map((entry) => entry.row);
  return { month, rows: list, total_earned_cents: list.reduce((sum, row) => sum + row.earned_cents, 0) };
}

const csvText = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

function csvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : csvText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const twoDecimals = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** RFC 4180 with CRLF after every line, two-decimal amounts and Brussels departure times. */
export function earningsCsv(earnings: Earnings): string {
  const lines = [["booking_id", "departure", "from", "to", "passenger", "seats", "paid", "refunded", "earned", "status"]];
  for (const row of earnings.rows) {
    const at = new Date(row.departure);
    lines.push([
      row.booking_id, `${dateKey(at)} ${hhmm(at)}`, row.from, row.to, row.passenger, String(row.seats),
      twoDecimals(row.paid_cents), twoDecimals(row.refunded_cents), twoDecimals(row.earned_cents), row.status,
    ]);
  }
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
