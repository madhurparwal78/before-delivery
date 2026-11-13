import type { Contract, InvoiceLine, WeekStatement } from "../shared/api.js";
import { addDays, mondayOf } from "../shared/calendar.js";
import { isoAt, localDateAt } from "./agency.js";
import { type BookingData, type LineRow, LINE_SELECT, heldCount, invoiceLineJson, syncStatusOf } from "./bookings.js";
import { type Db, one, rows } from "./db.js";
import { apiErrors } from "./errors.js";
import { type LineArithmetic, type RateRow, computeLine, selectRate } from "./rules/pricing.js";
import { type BillingItem, BillingUnavailable, currentAmountCents, findAccountId, invoiceItems } from "./services/killbill.js";

/** The contract rate in force on the booking's agency-local start date, and the line arithmetic it gives. */
export function priceBooking(
  data: BookingData,
  contract: Contract,
  basisMinutes: number,
  mileageMiles: number,
): { rate: RateRow; arithmetic: LineArithmetic } {
  const rate = selectRate(contract.rates, data.row.start_date);
  return { rate, arithmetic: computeLine(contract, rate, basisMinutes, heldCount(data), mileageMiles) };
}

/** Serialises line creation and week closing per organisation. */
export async function lockOrganisationBilling(client: Db, orgId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(4173, hashtext($1))", [orgId]);
}

async function billingWeekFor(client: Db, orgId: string, nowMs: number): Promise<string> {
  let week = mondayOf(localDateAt(nowMs));
  for (;;) {
    const closed = await one<{ week_start: string }>(client, "SELECT week_start FROM billing_weeks WHERE org_id = $1 AND week_start = $2", [orgId, week]);
    if (closed === null) return week;
    week = addDays(week, 7);
  }
}

/** Records the one invoice line of a booking, priced from its contract; it starts pending sync. */
export async function createInvoiceLine(
  client: Db,
  data: BookingData,
  contract: Contract,
  kind: LineRow["kind"],
  basisMinutes: number,
  mileageMiles: number,
  nowMs: number,
): Promise<LineRow> {
  await lockOrganisationBilling(client, data.row.org_id);
  const { rate, arithmetic } = priceBooking(data, contract, basisMinutes, mileageMiles);
  const week = await billingWeekFor(client, data.row.org_id, nowMs);
  const inserted = await rows<{ line_ref: string }>(
    client,
    `INSERT INTO invoice_lines (line_ref, booking_id, org_id, kind, assignment_date, rate_effective_from, hourly_rate_cents,
        team_surcharge_bp, basis_minutes, billable_minutes, interpreter_count, time_amount_cents, mileage_miles,
        mileage_cents_per_mile, mileage_amount_cents, amount_cents, billing_week)
     VALUES ('LN-' || nextval('line_ref_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING line_ref`,
    [
      data.row.id,
      data.row.org_id,
      kind,
      data.row.start_date,
      rate.effective_from,
      rate.hourly_rate_cents,
      rate.team_surcharge_bp,
      arithmetic.basis_minutes,
      arithmetic.billable_minutes,
      arithmetic.interpreter_count,
      arithmetic.time_amount_cents,
      arithmetic.mileage_miles,
      rate.mileage_cents_per_mile,
      arithmetic.mileage_amount_cents,
      arithmetic.amount_cents,
      week,
    ],
  );
  const lineRef = inserted[0]?.line_ref ?? "";
  const line = await one<LineRow>(client, `${LINE_SELECT} WHERE l.line_ref = $1`, [lineRef]);
  if (line === null) throw new Error("the invoice line was not stored");
  return line;
}

export type BillingRead = { reachable: true; items: BillingItem[] } | { reachable: false };

/** Reads an organisation's Kill Bill invoice items; reports plainly when Kill Bill cannot be read. */
export async function readBilling(orgId: string): Promise<BillingRead> {
  try {
    const accountId = await findAccountId(orgId);
    return { reachable: true, items: accountId === null ? [] : await invoiceItems(accountId) };
  } catch (error) {
    if (error instanceof BillingUnavailable) return { reachable: false };
    throw error;
  }
}

function billingAmountOf(line: LineRow, read: BillingRead): number | null {
  if (!read.reachable || syncStatusOf(line) === "pending_sync") return null;
  const charge = read.items.find((item) => item.invoiceItemId === line.kb_item_id);
  return charge === undefined ? 0 : currentAmountCents(read.items, charge);
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

interface WeekRow {
  closed_at: Date;
  relayline_total_cents: number;
  billing_total_cents: number;
}

const loadWeekRow = (db: Db, orgId: string, weekStart: string): Promise<WeekRow | null> =>
  one<WeekRow>(db, "SELECT closed_at, relayline_total_cents, billing_total_cents FROM billing_weeks WHERE org_id = $1 AND week_start = $2", [orgId, weekStart]);

async function loadWeekLines(db: Db, orgId: string, weekStart: string): Promise<LineRow[]> {
  return rows<LineRow>(db, `${LINE_SELECT} WHERE l.org_id = $1 AND l.billing_week = $2 ORDER BY l.id`, [orgId, weekStart]);
}

export async function weekStatement(db: Db, orgId: string, orgName: string, weekStart: string): Promise<WeekStatement> {
  const lines = await loadWeekLines(db, orgId, weekStart);
  const closed = await loadWeekRow(db, orgId, weekStart);
  const read = await readBilling(orgId);
  const amounts = lines.map((line) => billingAmountOf(line, read));
  const known = amounts.every((amount): amount is number => amount !== null);
  const jsonLines: InvoiceLine[] = lines.map((line, index) => invoiceLineJson(line, amounts[index] ?? null));
  return {
    org_id: orgId,
    org_name: orgName,
    week_start: weekStart,
    status: closed === null ? "open" : "closed",
    lines: jsonLines,
    relayline_total_cents: sum(lines.map((line) => line.amount_cents)),
    billing_total_cents: closed !== null ? closed.billing_total_cents : known && read.reachable ? sum(amounts.filter((amount): amount is number => amount !== null)) : null,
    billing_reachable: read.reachable,
    closed_at: closed === null ? null : isoAt(closed.closed_at.getTime()),
  };
}

/** Closes a week when every line is synced and the two totals match to the cent; checks run in the brief's order. */
export async function closeWeek(client: Db, orgId: string, orgName: string, weekStart: string): Promise<WeekStatement> {
  await lockOrganisationBilling(client, orgId);
  const already = await loadWeekRow(client, orgId, weekStart);
  if (already !== null) throw apiErrors.weekClosed();
  const lines = await loadWeekLines(client, orgId, weekStart);
  const pending = lines.filter((line) => syncStatusOf(line) === "pending_sync");
  if (pending.length > 0) throw apiErrors.pendingSync(pending.map((line) => line.line_ref));
  const read = await readBilling(orgId);
  if (!read.reachable) throw apiErrors.billingUnavailable();
  const relaylineTotal = sum(lines.map((line) => line.amount_cents));
  const billingTotal = sum(lines.map((line) => billingAmountOf(line, read) ?? 0));
  if (relaylineTotal !== billingTotal) throw apiErrors.totalMismatch(relaylineTotal, billingTotal);
  await client.query(
    "INSERT INTO billing_weeks (org_id, week_start, closed_at, relayline_total_cents, billing_total_cents) VALUES ($1, $2, now(), $3, $4)",
    [orgId, weekStart, relaylineTotal, billingTotal],
  );
  return weekStatement(client, orgId, orgName, weekStart);
}
