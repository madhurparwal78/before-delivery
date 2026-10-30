// Group invoices: issued at checkout as one Kill Bill invoice with an item per line, collected on the due date,
// returned, retried at 1, 3 and 7 billing days after the first return, and written off after the third retry.
import type { User } from "../auth.ts";
import { config } from "../config.ts";
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import * as killbill from "../services/killbill.ts";
import { audit } from "./audit.ts";
import { newId } from "./ids.ts";
import { mails } from "./mails.ts";
import { queueMail } from "./outbox.ts";
import { edition } from "./programme.ts";
import { isoOrNull, isoUtc } from "./time.ts";
import { asObject } from "./validate.ts";

const DUE_BILLING_DAYS = 30;
const RETRY_BILLING_DAYS = [1, 3, 7] as const;
const SETTLED_AFTER_RETRY_DAYS = 2;
const billingDays = (n: number) => n * config.time.billingDaySeconds * 1000;

type InvoiceStatus = "issued" | "paid" | "payment_failed" | "retried" | "written_off";

async function nextNumber(q: Db, counter: "invoice" | "credit_note", prefix: string): Promise<string> {
  const year = (await edition(q)).first_day.slice(0, 4);
  const row = await q.one<{ value: number }>(
    "INSERT INTO counters (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value", [`${counter}-${year}`]);
  return `${prefix}-${year}-${String(row!.value).padStart(4, "0")}`;
}

type InvoiceLineInput = { id: string; title: string; holder_name: string; charged_cents: number };

/** Issues the group order's invoice in Kill Bill and in the app, with its mail, inside the checkout transaction. */
export async function issueInvoice(tx: Db, input: { orderId: string; ref: string; booker: User; lines: InvoiceLineInput[]; totalCents: number; undo: (() => Promise<void>)[] }): Promise<void> {
  const org = (await tx.one<{ id: string; name: string }>("SELECT id, name FROM organisations WHERE id = $1", [input.booker.organisation_id]))!;
  const account = await killbill.accountFor(`kerf-org-${org.id}`, org.name, null);
  const charges = input.lines.map((l) => ({ description: `${input.ref} · ${l.title} · ${l.holder_name}`, cents: l.charged_cents }));
  const kb = await killbill.invoiceCharges(account, charges);
  input.undo.push(() => killbill.voidInvoice(kb.invoiceId));
  const id = newId();
  const number = await nextNumber(tx, "invoice", "INV");
  const issued = new Date();
  const due = new Date(issued.getTime() + billingDays(DUE_BILLING_DAYS));
  await tx.query(`INSERT INTO invoices (id, number, organisation_id, order_id, booker_id, status, amount_cents, issued_at, due_at, kb_invoice_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, number, org.id, input.orderId, input.booker.id, input.totalCents <= 0 ? "paid" : "issued", input.totalCents, issued, due, kb.invoiceId]);
  for (const [i, line] of input.lines.entries()) {
    await tx.query("INSERT INTO invoice_lines (invoice_id, line_id, description, amount_cents, kb_item_id) VALUES ($1,$2,$3,$4,$5)",
      [id, line.id, charges[i]!.description, line.charged_cents, kb.itemIds[i]!]);
  }
  await queueMail(tx, mails.invoiceIssued(input.booker.email, number, charges.map((c) => ({ description: c.description, amount_cents: c.cents })), input.totalCents, due));
}

type InvoiceRow = {
  id: string; number: string; organisation_id: string; order_id: string; booker_id: string; status: InvoiceStatus; amount_cents: number;
  issued_at: Date; due_at: Date; retries_used: number; first_return_at: Date | null; next_retry_at: Date | null; retried_at: Date | null;
  kb_invoice_id: string; credited_cents: number; paid_cents: number;
};

/** credited = credit notes; paid = collections minus returns; balance = amount − credited − paid. */
const INVOICE_SELECT = `SELECT i.*,
  COALESCE((SELECT sum(amount_cents) FROM credit_notes c WHERE c.invoice_id = i.id), 0)::integer AS credited_cents,
  COALESCE((SELECT sum(amount_cents) FROM collections k WHERE k.invoice_id = i.id AND k.returned_at IS NULL), 0)::integer AS paid_cents
  FROM invoices i`;

export const balanceOf = (i: Pick<InvoiceRow, "amount_cents" | "credited_cents" | "paid_cents">) => i.amount_cents - i.credited_cents - i.paid_cents;

async function invoiceViews(q: Db, rows: InvoiceRow[]) {
  const ids = rows.map((r) => r.id);
  const lines = await q.all<{ invoice_id: string; line_id: string; description: string; amount_cents: number }>(
    "SELECT invoice_id, line_id, description, amount_cents FROM invoice_lines l JOIN lines x ON x.id = l.line_id WHERE invoice_id = ANY($1) ORDER BY x.position", [ids]);
  const notes = await q.all<{ id: string; invoice_id: string }>("SELECT id, invoice_id FROM credit_notes WHERE invoice_id = ANY($1) ORDER BY issued_at", [ids]);
  return rows.map((r) => ({
    id: r.id, number: r.number, organisation_id: r.organisation_id, order_id: r.order_id, status: r.status,
    amount_cents: r.amount_cents, credited_cents: r.credited_cents, paid_cents: r.paid_cents, balance_cents: balanceOf(r),
    issued_at: isoUtc(r.issued_at), due_at: isoUtc(r.due_at), retries_used: r.retries_used, next_retry_at: isoOrNull(r.next_retry_at),
    credit_note_ids: notes.filter((n) => n.invoice_id === r.id).map((n) => n.id),
    lines: lines.filter((l) => l.invoice_id === r.id).map(({ line_id, description, amount_cents }) => ({ line_id, description, amount_cents })),
  }));
}

/** Invoices and credit notes are visible to the organisation's group bookers and to finance. */
function scope(user: User): string | null {
  return user.role === "finance" ? null : user.organisation_id;
}

async function invoicesFor(q: Db, user: User): Promise<InvoiceRow[]> {
  return q.all<InvoiceRow>(`${INVOICE_SELECT} WHERE ($1::text IS NULL OR i.organisation_id = $1) ORDER BY i.issued_at DESC`, [scope(user)]);
}

export async function invoicesOfOrganisation(q: Db, organisationId: string) {
  return invoiceViews(q, await q.all<InvoiceRow>(`${INVOICE_SELECT} WHERE i.organisation_id = $1 ORDER BY i.issued_at DESC`, [organisationId]));
}

const READERS = ["group_booker", "finance"] as const;

route("GET", "/api/invoices", READERS, async (ctx) => ok({ invoices: await invoiceViews(db, await invoicesFor(db, ctx.user)) }));

route("GET", "/api/invoices/:id", READERS, async (ctx) => {
  const row = await db.one<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 AND ($2::text IS NULL OR i.organisation_id = $2)`, [ctx.params.id!, scope(ctx.user)]);
  if (!row) throw notFound();
  return ok((await invoiceViews(db, [row]))[0]);
});

route("GET", "/api/credit-notes/:id", READERS, async (ctx) => {
  const note = await db.one<{ id: string; number: string; invoice_id: string; amount_cents: number; issued_at: Date }>(
    `SELECT c.id, c.number, c.invoice_id, c.amount_cents, c.issued_at FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
     WHERE c.id = $1 AND ($2::text IS NULL OR i.organisation_id = $2)`, [ctx.params.id!, scope(ctx.user)]);
  if (!note) throw notFound();
  const lines = await db.all<{ line_id: string; description: string; amount_cents: number }>(
    "SELECT line_id, description, amount_cents FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY description", [note.id]);
  return ok({ ...note, issued_at: isoUtc(note.issued_at), lines });
});

/** One credit note for the refunded lines of a group order; its Kill Bill item adjustments run as a payment task. */
export async function issueCreditNote(tx: Db, orderId: string, lines: readonly { id: string; charged_cents: number }[]): Promise<string> {
  const invoice = (await tx.one<{ id: string; number: string; booker_email: string }>(
    "SELECT i.id, i.number, u.email AS booker_email FROM invoices i JOIN users u ON u.id = i.booker_id WHERE i.order_id = $1", [orderId]))!;
  const id = newId();
  const number = await nextNumber(tx, "credit_note", "CN");
  const amount = lines.reduce((s, l) => s + l.charged_cents, 0);
  await tx.query("INSERT INTO credit_notes (id, number, invoice_id, amount_cents, issued_at) VALUES ($1,$2,$3,$4,$5)", [id, number, invoice.id, amount, new Date()]);
  const described = await tx.all<{ line_id: string; description: string; amount_cents: number }>(
    "SELECT line_id, description, amount_cents FROM invoice_lines WHERE invoice_id = $1 AND line_id = ANY($2)", [invoice.id, lines.map((l) => l.id)]);
  for (const d of described) {
    await tx.query("INSERT INTO credit_note_lines (credit_note_id, line_id, description, amount_cents) VALUES ($1,$2,$3,$4)", [id, d.line_id, d.description, d.amount_cents]);
  }
  await queueMail(tx, mails.creditNote(invoice.booker_email, number, invoice.number, described, amount));
  return id;
}

/** Applies a credit note's item adjustments in Kill Bill, each line once. */
export async function adjustCreditNote(tx: Db, creditNoteId: string): Promise<void> {
  const pending = await tx.all<{ line_id: string; amount_cents: number; kb_item_id: string; kb_invoice_id: string; organisation_id: string; number: string }>(
    `SELECT n.line_id, n.amount_cents, il.kb_item_id, i.kb_invoice_id, i.organisation_id, c.number FROM credit_note_lines n
     JOIN credit_notes c ON c.id = n.credit_note_id JOIN invoices i ON i.id = c.invoice_id
     JOIN invoice_lines il ON il.invoice_id = i.id AND il.line_id = n.line_id WHERE n.credit_note_id = $1 AND NOT n.adjusted`, [creditNoteId]);
  for (const p of pending) {
    const org = (await tx.one<{ name: string }>("SELECT name FROM organisations WHERE id = $1", [p.organisation_id]))!;
    const account = await killbill.accountFor(`kerf-org-${p.organisation_id}`, org.name, null);
    if (p.amount_cents > 0) await killbill.adjustItem(account, p.kb_invoice_id, p.kb_item_id, p.amount_cents, `Credit note ${p.number}`);
    await tx.query("UPDATE credit_note_lines SET adjusted = true WHERE credit_note_id = $1 AND line_id = $2", [creditNoteId, p.line_id]);
  }
}

async function collectOnce(tx: Db, invoice: InvoiceRow, now: Date, action: "invoice.collected" | "invoice.retried"): Promise<void> {
  const balance = balanceOf(invoice);
  const attempt = (await tx.one<{ n: number }>("SELECT count(*)::integer AS n FROM collections WHERE invoice_id = $1", [invoice.id]))!.n + 1;
  const org = (await tx.one<{ name: string }>("SELECT name FROM organisations WHERE id = $1", [invoice.organisation_id]))!;
  const account = await killbill.accountFor(`kerf-org-${invoice.organisation_id}`, org.name, null);
  const key = `${invoice.number}-${attempt}`;
  const paid = await killbill.collect(account, invoice.kb_invoice_id, key, balance);
  await killbill.recordTransaction(tx, paid.paymentId, paid.tx, { invoiceNumber: invoice.number });
  await tx.query("INSERT INTO collections (invoice_id, attempt, kb_payment_id, amount_cents, collected_at) VALUES ($1,$2,$3,$4,$5)",
    [invoice.id, attempt, paid.paymentId, balance, now]);
  const status: InvoiceStatus = action === "invoice.collected" ? "paid" : "retried";
  await tx.query(`UPDATE invoices SET status = $2${action === "invoice.retried" ? ", retries_used = retries_used + 1, retried_at = $3, next_retry_at = NULL" : ""} WHERE id = $1`,
    action === "invoice.retried" ? [invoice.id, status, now] : [invoice.id, status]);
  await audit(tx, "system", action, { type: "invoice", id: invoice.id }, { attempt, amount_cents: balance });
}

/** The worker's pass: due collections, due retries, and retried invoices settling after two quiet billing days. */
export async function invoiceSweep(): Promise<void> {
  const now = new Date();
  const DUE = `((i.status = 'issued' AND i.due_at <= $1) OR (i.status = 'payment_failed' AND i.next_retry_at <= $1)
    OR (i.status = 'retried' AND i.retried_at <= $2))`;
  const params = [now, new Date(now.getTime() - billingDays(SETTLED_AFTER_RETRY_DAYS))];
  const failures: string[] = [];
  for (const { id } of await db.all<{ id: string }>(`SELECT i.id FROM invoices i WHERE ${DUE} ORDER BY i.due_at`, params)) {
    await transaction(async (tx) => {
      const due = await tx.one<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $3 AND ${DUE} FOR UPDATE OF i SKIP LOCKED`, [...params, id]);
      if (!due) return;
      if (due.status === "retried") {
        await tx.query("UPDATE invoices SET status = 'paid', retried_at = NULL WHERE id = $1", [due.id]);
        await audit(tx, "system", "invoice.settled", { type: "invoice", id: due.id });
      } else if (due.status === "issued" && balanceOf(due) <= 0) {
        await tx.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [due.id]);
        await audit(tx, "system", "invoice.collected", { type: "invoice", id: due.id }, { amount_cents: 0 });
      } else await collectOnce(tx, due, now, due.status === "issued" ? "invoice.collected" : "invoice.retried");
    }).catch((error: unknown) => failures.push(error instanceof Error ? error.message : String(error)));
  }
  if (failures.length) throw new Error(failures.join("; "));
}

route("POST", "/api/finance/invoices/:id/returns", ["finance"], async (ctx) => {
  const view = await transaction(async (tx) => {
    const invoice = await tx.one<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [ctx.params.id!]);
    if (!invoice) throw notFound();
    const latest = await tx.one<{ attempt: number; kb_payment_id: string; amount_cents: number }>(
      "SELECT attempt, kb_payment_id, amount_cents FROM collections WHERE invoice_id = $1 AND returned_at IS NULL ORDER BY attempt DESC LIMIT 1", [invoice.id]);
    if (!(invoice.status === "paid" || invoice.status === "retried") || !latest) throw new ApiError(409, "not_collected");
    const note = typeof asObject(ctx.body).note === "string" ? (asObject(ctx.body).note as string).trim() : "";
    if (!note) throw new FieldErrors({ note: "required" });
    const now = new Date();
    const returned = await killbill.chargeback(latest.kb_payment_id, `${invoice.number}-${latest.attempt}-return`, latest.amount_cents);
    await killbill.recordTransaction(tx, latest.kb_payment_id, returned, { invoiceNumber: invoice.number });
    await tx.query("UPDATE collections SET returned_at = $3 WHERE invoice_id = $1 AND attempt = $2", [invoice.id, latest.attempt, now]);
    const writtenOff = invoice.retries_used >= RETRY_BILLING_DAYS.length;
    const firstReturn = invoice.first_return_at ?? now;
    const nextRetry = writtenOff ? null : new Date(firstReturn.getTime() + billingDays(RETRY_BILLING_DAYS[invoice.retries_used]!));
    if (writtenOff) await killbill.writeOff(invoice.kb_invoice_id);
    await tx.query("UPDATE invoices SET status = $2, first_return_at = $3, next_retry_at = $4, retried_at = NULL WHERE id = $1",
      [invoice.id, writtenOff ? "written_off" : "payment_failed", firstReturn, nextRetry]);
    const booker = (await tx.one<{ email: string }>("SELECT email FROM users WHERE id = $1", [invoice.booker_id]))!;
    await queueMail(tx, mails.bankReturn(booker.email, invoice.number, nextRetry));
    await audit(tx, ctx.user, "invoice.returned", { type: "invoice", id: invoice.id },
      { note, attempt: latest.attempt, next_retry_at: isoOrNull(nextRetry) });
    if (writtenOff) await audit(tx, "system", "invoice.written_off", { type: "invoice", id: invoice.id });
    return (await invoiceViews(tx, [(await tx.one<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1`, [invoice.id]))!]))[0];
  });
  return ok(view);
});
