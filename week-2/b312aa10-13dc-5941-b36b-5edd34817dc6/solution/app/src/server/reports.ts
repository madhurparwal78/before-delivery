// Monthly utilisation per station and the usage CSV for the bookkeeper.

import { pool, type Db } from "./db.js";
import { surfaceText } from "./frozen.js";
import { forbidden, route } from "./http.js";
import { applyDueLapses } from "./states.js";
import { balanceQuarters } from "./ledger.js";
import { monthParam } from "./kitchen.js";
import { BOOKING_SQL, billingStatusOf, type BookingRow } from "./bookings.js";
import { COUNTED } from "../shared/rules.js";
import { hoursText, plainMoney } from "../shared/format.js";
import { localDateOf, type Month } from "../shared/time.js";

/** A spreadsheet must show these as text: any cell starting with = + - @ tab or CR gets an apostrophe. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const unwaivedFee = (b: BookingRow): number => (b.status === "cancelled_late" && !b.penalty_waived ? b.penalty_cents : 0);

async function monthBookings(db: Db, kitchenId: string, month: Month): Promise<BookingRow[]> {
  await applyDueLapses(db, kitchenId);
  const { rows } = await db.query(
    `${BOOKING_SQL} WHERE b.kitchen_id = $1 AND to_char(b.local_date, 'YYYY-MM') = $2 AND b.confirmed_at IS NOT NULL ORDER BY b.start_at, b.id`,
    [kitchenId, month],
  );
  return rows as BookingRow[];
}

/** The live utilisation report: counted bookings and unwaived fees per station, plus the month's adjustment credits. */
export async function utilisationText(db: Db, kitchenId: string, month: Month): Promise<string> {
  const bookings = await monthBookings(db, kitchenId, month);
  const { rows: stations } = await db.query("SELECT id, name FROM stations WHERE kitchen_id = $1 ORDER BY position", [kitchenId]);
  const rows = stations.map((st) => {
    const mine = bookings.filter((b) => b.station_id === st.id);
    const counted = mine.filter((b) => COUNTED.includes(b.status));
    return {
      stationId: st.id as string, name: st.name as string,
      bookedHours: counted.reduce((n, b) => n + b.quarters, 0) / 4,
      peakHours: counted.reduce((n, b) => n + b.peak_quarters, 0) / 4,
      shelfDays: counted.reduce((n, b) => n + (b.days ?? 0), 0),
      revenueCents: counted.reduce((n, b) => n + b.charge_cents, 0) + mine.reduce((n, b) => n + unwaivedFee(b), 0),
    };
  });
  const { rows: adjustments } = await db.query(
    "SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM billing_items WHERE kitchen_id = $1 AND month = $2 AND kind = 'Adjustment'",
    [kitchenId, month]);
  const sum = (k: "bookedHours" | "peakHours" | "shelfDays" | "revenueCents") => rows.reduce((n, r) => n + r[k], 0);
  return JSON.stringify({
    month, stations: rows,
    totals: { bookedHours: sum("bookedHours"), peakHours: sum("peakHours"), shelfDays: sum("shelfDays"), revenueCents: sum("revenueCents"), adjustmentCents: adjustments[0].cents },
  });
}

route("GET", "/api/reports/utilisation", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const month = monthParam(ctx);
  const text = await surfaceText(pool, s.kitchen.id, month, "report", "", () => utilisationText(pool, s.kitchen.id, month));
  return { status: 200, body: JSON.parse(text) };
});

/**
 * Which business name a month's export shows: the close-time names once the month is closed
 * (empty for an open month, whose rows carry the current name).
 */
async function surfaceNames(db: Db, kitchenId: string, month: Month): Promise<Map<string, string>> {
  const { rows } = await db.query("SELECT member_id, business_name FROM close_time_names WHERE kitchen_id = $1 AND month = $2", [kitchenId, month]);
  return new Map(rows.map((r) => [r.member_id as string, r.business_name as string]));
}

const HEADER = "booking_id,member_id,business_name,station,date,start,end,hours,peak_hours,shelf_days,status,charge,penalty,billing_status,hour_bank_balance,notes";

/** A numeric cell: written as a plain number, never quoted or prefixed. */
function numberCell(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`not a plain number: ${value}`);
  return value;
}

/** Column order of HEADER; the numeric columns are written by numberCell, every other one by csvCell. */
const NUMERIC = new Set([7, 8, 9, 11, 12, 14]);
const csvRow = (cells: string[]): string => cells.map((c, i) => (NUMERIC.has(i) ? numberCell(c) : csvCell(c))).join(",");

/**
 * The live usage CSV, UTF-8 with CRLF line endings: one row per booking that reached confirmed,
 * then one adjustment row per adjustment credit filed in the month, in filing order.
 */
export async function usageCsvText(db: Db, kitchenId: string, month: Month): Promise<string> {
  const bookings = await monthBookings(db, kitchenId, month);
  const { rows: zoneRows } = await db.query("SELECT time_zone FROM kitchens WHERE id = $1", [kitchenId]);
  const zone = zoneRows[0].time_zone as string;
  const { rows: adjustments } = await db.query(
    `SELECT i.booking_id, i.amount_cents, i.created_at, i.recorded_at, b.member_id, m.business_name, s.name AS station_name
     FROM billing_items i JOIN bookings b ON b.id = i.booking_id JOIN members m ON m.id = b.member_id JOIN stations s ON s.id = b.station_id
     WHERE i.kitchen_id = $1 AND i.month = $2 AND i.kind = 'Adjustment' ORDER BY i.created_at, i.id`,
    [kitchenId, month],
  );
  const balances = new Map<string, number>();
  for (const memberId of [...bookings.map((b) => b.member_id), ...adjustments.map((a) => a.member_id as string)]) {
    if (!balances.has(memberId)) balances.set(memberId, (await balanceQuarters(db, memberId, month)).balance);
  }
  const names = await surfaceNames(db, kitchenId, month);
  const lines = [HEADER];
  for (const b of bookings) {
    const counted = COUNTED.includes(b.status);
    lines.push(csvRow([
      b.id, b.member_id, names.get(b.member_id) ?? b.business_name, b.station_name, b.local_date, b.local_start ?? "", b.local_end ?? "",
      hoursText(b.quarters), hoursText(b.peak_quarters), String(b.days ?? 0), b.status,
      plainMoney(counted ? b.charge_cents : 0), plainMoney(unwaivedFee(b)), billingStatusOf(b),
      hoursText(balances.get(b.member_id)!), b.notes,
    ]));
  }
  for (const a of adjustments) {
    lines.push(csvRow([
      a.booking_id, a.member_id, names.get(a.member_id) ?? a.business_name, a.station_name, localDateOf((a.created_at as Date).getTime(), zone), "", "",
      "0", "0", "0", "adjustment",
      plainMoney(a.amount_cents), plainMoney(0), a.recorded_at ? "billed" : "pending_billing",
      hoursText(balances.get(a.member_id)!), "",
    ]));
  }
  return lines.map((l) => `${l}\r\n`).join("");
}

route("GET", "/api/exports/usage.csv", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const month = monthParam(ctx);
  const text = await surfaceText(pool, s.kitchen.id, month, "csv", "", () => usageCsvText(pool, s.kitchen.id, month));
  return {
    status: 200,
    bytes: Buffer.from(text, "utf8"),
    headers: {
      "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="lineboard-usage-${s.kitchen.slug}-${month}.csv"`,
    },
  };
});
