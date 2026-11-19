import type { PoolClient } from "pg";
import { type Db, one, query, transaction } from "../db.js";
import { invalid, sendJson } from "../http.js";
import type { Context, Route } from "../router.js";
import { asObject, Checker, MONTH_KEY } from "../validate.js";
import { monthKeyAt, monthLabel } from "../../shared/dates.js";
import { settings } from "./session.js";

/**
 * A month's claimed count and openness, decided once in the production_month_state view (schema):
 * claimed is the number of accepted, deposit-paid and booked enquiries whose proposal names the month,
 * and a month is open while claimed is below capacity.
 */
export const MONTH_STATE_VIEW = `
CREATE OR REPLACE VIEW production_month_state AS
SELECT month, capacity, claimed, claimed < capacity AS open FROM (
  SELECT m.month, m.capacity,
    (SELECT count(*)::int FROM proposals pp JOIN enquiries e ON e.id = pp.enquiry_id
      WHERE pp.production_month = m.month AND e.status IN ('accepted', 'deposit_paid', 'booked')) AS claimed
  FROM production_months m) counted;
`;

interface MonthState {
  month: string;
  capacity: number;
  claimed: number;
  open: boolean;
}

async function currentMonth(): Promise<string> {
  return monthKeyAt(new Date(), (await settings()).time_zone);
}

export async function monthState(month: string, db?: Db): Promise<MonthState | undefined> {
  return one<MonthState>("SELECT month, capacity, claimed, open FROM production_month_state WHERE month = $1", [month], db);
}

/** Open now: from the current month on, with claimed below capacity. */
export async function monthIsOpen(db: Db, month: string): Promise<boolean> {
  return month >= (await currentMonth()) && ((await monthState(month, db))?.open ?? false);
}

/** Locks the month's record so acceptances and capacity changes for it are taken one at a time. */
export async function lockMonth(client: PoolClient, month: string): Promise<MonthState | undefined> {
  await client.query("SELECT month FROM production_months WHERE month = $1 FOR UPDATE", [month]);
  return monthState(month, client);
}

const view = (row: MonthState) => ({ month: row.month, label: monthLabel(row.month), capacity: row.capacity, claimed: row.claimed, open: row.open });

async function publicMonths({ res }: Context): Promise<void> {
  const rows = await query<MonthState>(
    "SELECT month, capacity, claimed, open FROM production_month_state WHERE open AND month >= $1 ORDER BY month",
    [await currentMonth()],
  );
  sendJson(res, 200, { months: rows.map((row) => ({ month: row.month, label: monthLabel(row.month) })) });
}

async function consoleMonths({ res }: Context): Promise<void> {
  const rows = await query<MonthState>(
    "SELECT month, capacity, claimed, open FROM production_month_state WHERE month >= $1 ORDER BY month",
    [await currentMonth()],
  );
  sendJson(res, 200, { months: rows.map(view) });
}

async function setCapacity({ res, json, params }: Context): Promise<void> {
  const month = params.month ?? "";
  const check = new Checker(asObject(json)).writable(["capacity"]);
  if (!MONTH_KEY.test(month)) check.error("month", "Use a month written as YYYY-MM.");
  else if (month < (await currentMonth())) check.error("month", "That month has already ended.");
  const capacity = check.integer("capacity", 0, 12);
  check.done();
  const saved = await transaction(async (client) => {
    await client.query("INSERT INTO production_months (month, capacity) VALUES ($1, $2) ON CONFLICT (month) DO NOTHING", [month, capacity]);
    const state = await lockMonth(client, month);
    const claimed = state?.claimed ?? 0;
    if (capacity < claimed) invalid({ capacity: `Capacity can’t be below the ${claimed} places already claimed.` });
    await client.query("UPDATE production_months SET capacity = $2 WHERE month = $1", [month, capacity]);
    return monthState(month, client);
  });
  if (saved) sendJson(res, 200, { month: view(saved) });
}

export const monthRoutes: Route[] = [
  { pattern: "/api/months", methods: { GET: { handler: publicMonths } } },
  { pattern: "/api/console/months", methods: { GET: { handler: consoleMonths } } },
  { pattern: "/api/console/months/:month", methods: { PUT: { handler: setCapacity } } },
];
