import { one, query } from "./db.ts";
import { ApiError } from "./errors.ts";
import { allPayments, requireBilling } from "./killbill.ts";
import { centsToDecimal, decimalToCents } from "./money.ts";
import type { Session } from "./sessions.ts";
import { businessDay, isoToronto, isValidDate, torontoDate } from "./time.ts";
import { Fields } from "./validate.ts";

type BookingRow = { ref: string; name: string; note: string; admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number; credit_applied_cents: number; paid_cents: number; paid_at: Date };
type RefundRow = { ref: string; name: string; note: string; refunded_cents: number; refunded_at: Date };
type GiftRow = { ref: string; purchaser_name: string; price_cents: number; credit_applied_cents: number; paid_cents: number; created_at: Date };
type InvoiceRow = { number: string; name: string; amount_cents: number; credit_applied_cents: number; created_at: Date };

async function dayRecords(start: Date, end: Date): Promise<{ bookings: BookingRow[]; refunds: RefundRow[]; gifts: GiftRow[]; invoices: InvoiceRow[] }> {
  const window = [start, end];
  return {
    bookings: await query<BookingRow>("SELECT ref, name, note, admission_cents, gst_cents, qst_cents, uplift_cents, credit_applied_cents, paid_cents, paid_at FROM bookings WHERE paid_at >= $1 AND paid_at < $2", window),
    refunds: await query<RefundRow>("SELECT ref, name, note, refunded_cents, refunded_at FROM bookings WHERE refunded_at >= $1 AND refunded_at < $2", window),
    gifts: await query<GiftRow>("SELECT ref, purchaser_name, price_cents, credit_applied_cents, paid_cents, created_at FROM gifts WHERE created_at >= $1 AND created_at < $2", window),
    invoices: await query<InvoiceRow>(
      `SELECT a.number, a.name, i.amount_cents, i.credit_applied_cents, i.created_at FROM membership_invoices i JOIN accounts a ON a.id = i.account_id
        WHERE i.created_at >= $1 AND i.created_at < $2 AND i.amount_cents > 0`, window),
  };
}

const sum = <T>(rows: T[], pick: (row: T) => number): number => rows.reduce((total, row) => total + pick(row), 0);

/** Successful PURCHASE and REFUND amounts whose effective dates fall in the window, on accounts the app created. */
async function killbillFigures(start: Date, end: Date): Promise<{ payments_cents: number; refunds_cents: number; net_payments_cents: number }> {
  const ours = new Set((await query<{ id: string }>(
    "SELECT kb_account_id AS id FROM accounts WHERE kb_account_id IS NOT NULL UNION SELECT kb_account_id FROM guest_billing_accounts",
  )).map((row) => row.id));
  let payments = 0;
  let refunds = 0;
  for (const payment of await allPayments()) {
    if (!ours.has(payment.accountId)) continue;
    for (const tx of payment.transactions) {
      const at = new Date(tx.effectiveDate);
      if (tx.status !== "SUCCESS" || at < start || at >= end) continue;
      if (tx.transactionType === "PURCHASE") payments += decimalToCents(tx.amount);
      if (tx.transactionType === "REFUND") refunds += decimalToCents(tx.amount);
    }
  }
  return { payments_cents: payments, refunds_cents: refunds, net_payments_cents: payments - refunds };
}

function readDate(value: unknown): string {
  if (value === undefined || value === null || value === "") return torontoDate(new Date());
  if (!isValidDate(value)) throw new ApiError("validation", {}, { fields: { date: { kind: "date" } } });
  return value;
}

export async function reconciliation(rawDate: unknown): Promise<Record<string, unknown>> {
  const date = readDate(rawDate);
  requireBilling();
  const { start, end } = businessDay(date);
  const day = await dayRecords(start, end);
  const local = {
    admission_cents: sum(day.bookings, (b) => b.admission_cents),
    gst_cents: sum(day.bookings, (b) => b.gst_cents),
    qst_cents: sum(day.bookings, (b) => b.qst_cents),
    uplift_cents: sum(day.bookings, (b) => b.uplift_cents),
    gift_cents: sum(day.gifts, (g) => g.price_cents),
    membership_cents: sum(day.invoices, (i) => i.amount_cents),
    credit_spent_cents: sum(day.bookings, (b) => b.credit_applied_cents) + sum(day.gifts, (g) => g.credit_applied_cents) + sum(day.invoices, (i) => i.credit_applied_cents),
    refunds_cents: sum(day.refunds, (r) => r.refunded_cents),
    net_payments_cents: 0,
  };
  local.net_payments_cents = local.admission_cents + local.gst_cents + local.qst_cents + local.uplift_cents + local.gift_cents + local.membership_cents - local.credit_spent_cents - local.refunds_cents;
  const killbill = await killbillFigures(start, end);
  const difference = killbill.net_payments_cents - local.net_payments_cents;
  const accepted = await one<{ difference_cents: number }>("SELECT difference_cents FROM reconciliation_acceptances WHERE business_date = $1 ORDER BY id DESC LIMIT 1", [date]);
  const status = difference === 0 ? "matched" : accepted && accepted.difference_cents === difference ? "accepted" : "mismatch";
  return {
    date, timezone: "America/Toronto", window_start: isoToronto(start), window_end: isoToronto(end), local, killbill,
    difference_cents: difference, status, accepted_difference_cents: accepted?.difference_cents ?? null,
  };
}

export async function acceptKillBillFigure(staff: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fields = new Fields(body);
  const reason = fields.text("reason", 3, 500);
  if (!isValidDate(body.date)) {
    fields.add("date", { kind: "date" });
    fields.done();
  }
  const date = String(body.date);
  const current = await reconciliation(date);
  if (current.status !== "mismatch") throw new ApiError("nothing_to_accept");
  fields.done();
  const difference = Number(current.difference_cents);
  await query("INSERT INTO reconciliation_acceptances (business_date, difference_cents) VALUES ($1, $2)", [date, difference]);
  await query("INSERT INTO audit_log (actor, action, target, amount_cents, reason) VALUES ($1, 'reconciliation-accept', $2, $3, $4)", [staff.account.email, date, difference, reason]);
  return reconciliation(date);
}

/** CSV cell: formula characters neutralised with a leading `'`, then RFC 4180 quoting. */
function cell(value: string, patronText = false): string {
  const safe = patronText && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function reconciliationCsv(rawDate: unknown): Promise<{ date: string; csv: string }> {
  const date = readDate(rawDate);
  requireBilling();
  const { start, end } = businessDay(date);
  const day = await dayRecords(start, end);
  const money = (cents: number): string => centsToDecimal(cents);
  type Line = { at: Date; ref: string; cells: string[] };
  const row = (kind: string, ref: string, at: Date, name: string, note: string, amounts: number[]): Line => ({
    at, ref, cells: [kind, cell(ref), cell(isoToronto(at)), cell(name, true), cell(note, true), ...amounts.map(money)],
  });
  const lines: Line[] = [
    ...day.bookings.map((b) => row("booking", b.ref, b.paid_at, b.name, b.note, [
      b.admission_cents, b.gst_cents, b.qst_cents, b.uplift_cents, 0, 0, b.credit_applied_cents,
      b.paid_cents, 0])),
    ...day.gifts.map((g) => row("gift", g.ref, g.created_at, g.purchaser_name, "", [0, 0, 0, 0, g.price_cents, 0, g.credit_applied_cents, g.paid_cents, 0])),
    ...day.invoices.map((i) => row("membership", i.number, i.created_at, i.name, "", [0, 0, 0, 0, 0, i.amount_cents, i.credit_applied_cents, i.amount_cents - i.credit_applied_cents, 0])),
    ...day.refunds.map((r) => row("refund", r.ref, r.refunded_at, r.name, r.note, [0, 0, 0, 0, 0, 0, 0, 0, r.refunded_cents])),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.ref.localeCompare(b.ref));
  const header = "kind,reference,occurred_at,patron_name,note,admission,gst,qst,uplift,gift,membership,credit_spent,paid,refunded";
  return { date, csv: [header, ...lines.map((line) => line.cells.join(","))].map((l) => `${l}\r\n`).join("") };
}
