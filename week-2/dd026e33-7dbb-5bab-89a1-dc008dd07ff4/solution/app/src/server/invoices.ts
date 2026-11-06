// Invoices (brief: Business rules › Invoice issue, Invoice balance and status, Bank transfers).
// Balance and paid status come only from Kill Bill; every read that reaches it updates the stored
// last-confirmed copy, and a read it does not answer uses that copy with balance_live false.
import type { Hold, Invoice, Line, Payment } from "../shared/api.js";
import { carName, type Role } from "../shared/domain.js";
import { decimalPlaces, parseDecimal, toScaled } from "../shared/decimal.js";
import { zurichDay, zurichParts } from "../shared/zurich.js";
import { jobActionAllowed } from "../shared/transitions.js";
import { requireRole } from "./auth.js";
import { iso, many, newId, one, type Db } from "./db.js";
import { billingUnavailable, conflict, FieldErrors, notFound, ProviderDown } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { chargeAccount, invoiceState, recordExternalPayment, transferKey, type KbInvoiceState } from "./killbill.js";
import { invoiceIssuedEmail } from "./mail.js";
import { chf } from "./money.js";
import { presentActor, presentInvoice, type Viewer } from "./projection.js";
import { jobReply, jobTotals, visibleJob } from "./jobs.js";
import { accountFor, enqueueEmail } from "./queue.js";

interface InvoiceRow {
  [key: string]: unknown;
  id: string;
  number: string;
  job_id: string;
  car_id: string;
  owner_id: string;
  owner_name: string;
  car_year: number;
  car_make: string;
  car_model: string;
  killbill_invoice_id: string;
  lines: Line[];
  net_centimes: string;
  vat_centimes: string;
  rounding_centimes: string;
  total_centimes: string;
  issued_at: Date;
  balance_centimes: string;
  paid_at: Date | null;
  payments: StoredPayment[];
  status_confirmed_at: Date;
}

interface StoredPayment {
  killbill_payment_id: string;
  amount_centimes: string;
  refunded_centimes: string;
  at: string;
}

const INVOICE_SELECT = `
  SELECT i.*, o.name AS owner_name, c.year AS car_year, c.make AS car_make, c.model AS car_model
    FROM invoices i JOIN users o ON o.id = i.owner_id JOIN cars c ON c.id = i.car_id`;

interface TransferRow {
  [key: string]: unknown;
  killbill_payment_id: string;
  reference: string;
  recorded_by: string;
  by_name: string;
  by_role: Role;
}

/** The invoice as Kill Bill reports it now, or its last confirmed copy when Kill Bill does not answer. */
interface InvoiceView {
  row: InvoiceRow;
  live: boolean;
}

async function applyConfirmed(db: Db, row: InvoiceRow, state: KbInvoiceState): Promise<InvoiceRow> {
  const payments: StoredPayment[] = state.payments.map((p) => ({
    killbill_payment_id: p.paymentId,
    amount_centimes: p.amountCentimes.toString(),
    refunded_centimes: p.refundedCentimes.toString(),
    at: p.at,
  }));
  const updated = await one<{ status_confirmed_at: Date }>(
    db,
    `UPDATE invoices SET balance_centimes = $2, paid_at = $3, payments = $4, status_confirmed_at = clock_timestamp()
      WHERE id = $1 RETURNING status_confirmed_at`,
    [row.id, state.balanceCentimes.toString(), state.paidAt, JSON.stringify(payments)],
  );
  // Paid is never latched: the job follows Kill Bill's balance both ways, one version step each.
  if (state.balanceCentimes === 0n) {
    await db.query("UPDATE jobs SET status = 'paid', version = version + 1 WHERE id = $1 AND status = 'invoiced'", [row.job_id]);
  } else {
    await db.query("UPDATE jobs SET status = 'invoiced', version = version + 1 WHERE id = $1 AND status = 'paid'", [row.job_id]);
  }
  return {
    ...row,
    balance_centimes: state.balanceCentimes.toString(),
    paid_at: state.paidAt ? new Date(state.paidAt) : null,
    payments,
    status_confirmed_at: updated?.status_confirmed_at ?? row.status_confirmed_at,
  };
}

/** Asks Kill Bill for the invoice; stores what it answers. */
async function readInvoice(db: Db, row: InvoiceRow): Promise<InvoiceView> {
  try {
    const transfers = await many<{ id: string }>(db, "SELECT killbill_payment_id AS id FROM bank_transfers WHERE invoice_id = $1", [row.id]);
    const state = await invoiceState(row.killbill_invoice_id, transfers.map((t) => t.id));
    return { row: await applyConfirmed(db, row, state), live: true };
  } catch (error) {
    if (error instanceof ProviderDown) return { row, live: false };
    throw error;
  }
}

async function presentView(db: Db, viewer: Viewer, view: InvoiceView): Promise<Invoice> {
  const { row } = view;
  const transfers = await many<TransferRow>(
    db,
    `SELECT t.killbill_payment_id, t.reference, t.recorded_by, u.name AS by_name, u.role AS by_role
       FROM bank_transfers t JOIN users u ON u.id = t.recorded_by WHERE t.invoice_id = $1`,
    [row.id],
  );
  const balance = BigInt(row.balance_centimes);
  const payments: Payment[] = row.payments.map((p) => {
    const transfer = transfers.find((t) => t.killbill_payment_id === p.killbill_payment_id);
    return {
      killbill_payment_id: p.killbill_payment_id,
      amount: chf(BigInt(p.amount_centimes)),
      refunded: chf(BigInt(p.refunded_centimes)),
      reference: transfer?.reference ?? null,
      at: p.at,
      recorded_by: transfer ? presentActor(viewer, { id: transfer.recorded_by, name: transfer.by_name, role: transfer.by_role }) : null,
    };
  });
  const invoice: Invoice = {
    id: row.id,
    number: row.number,
    job_id: row.job_id,
    car: { id: row.car_id, name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }) },
    owner: presentActor(viewer, { id: row.owner_id, name: row.owner_name, role: "owner" }),
    lines: row.lines,
    net_total: chf(BigInt(row.net_centimes)),
    vat_total: chf(BigInt(row.vat_centimes)),
    rounding: chf(BigInt(row.rounding_centimes)),
    total: chf(BigInt(row.total_centimes)),
    currency: "CHF",
    balance: chf(balance),
    balance_live: view.live,
    status: balance === 0n ? "paid" : "awaiting_payment",
    issued_at: iso(row.issued_at),
    paid_at: balance === 0n && row.paid_at ? zurichDay(row.paid_at) : null,
    status_confirmed_at: iso(row.status_confirmed_at),
    payments,
    killbill_invoice_id: row.killbill_invoice_id,
  };
  return presentInvoice(viewer, invoice);
}

async function visibleInvoice(db: Db, viewer: Viewer, id: string, lock = false): Promise<InvoiceRow> {
  if (lock) await db.query("SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE", [id]);
  const row = await one<InvoiceRow>(db, `${INVOICE_SELECT} WHERE i.id = $1`, [id]);
  if (!row || (viewer.role === "owner" && row.owner_id !== viewer.id)) throw notFound();
  return row;
}

/** Every invoice the viewer may see, read live from Kill Bill where it answers. */
export async function readInvoices(db: Db, viewer: Viewer, where = "", params: unknown[] = []): Promise<InvoiceView[]> {
  const scope: string[] = [];
  const values = [...params];
  if (where) scope.push(where);
  if (viewer.role === "owner") {
    values.push(viewer.id);
    scope.push(`i.owner_id = $${values.length}`);
  }
  const rows = await many<InvoiceRow>(db, `${INVOICE_SELECT} ${scope.length ? `WHERE ${scope.join(" AND ")}` : ""} ORDER BY i.number`, values);
  return Promise.all(rows.map((row) => readInvoice(db, row)));
}

export async function presentViews(db: Db, viewer: Viewer, views: InvoiceView[]): Promise<Invoice[]> {
  return Promise.all(views.map((view) => presentView(db, viewer, view)));
}

/** The release hold: the car's invoices with a balance above zero (live, or last confirmed). */
export async function holdsFor(db: Db, carId: string): Promise<Hold[]> {
  const views = await readInvoices(db, { id: "", role: "house_manager" }, "i.car_id = $1", [carId]);
  return views
    .filter((v) => BigInt(v.row.balance_centimes) > 0n)
    .map((v) => ({ id: v.row.id, number: v.row.number, balance: chf(BigInt(v.row.balance_centimes)) }));
}

export async function listInvoices(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.user, "workshop_lead", "house_manager", "owner");
  const views = await readInvoices(ctx.db, ctx.user);
  const unpaid = views.reduce((sum, v) => (BigInt(v.row.balance_centimes) > 0n ? sum + BigInt(v.row.balance_centimes) : sum), 0n);
  return { status: 200, body: { invoices: await presentViews(ctx.db, ctx.user, views), unpaid_total: chf(unpaid) } };
}

export async function getInvoice(ctx: Ctx): Promise<Reply> {
  const row = await visibleInvoice(ctx.db, ctx.user, ctx.params.id ?? "");
  requireRole(ctx.user, "workshop_lead", "house_manager", "owner");
  return { status: 200, body: { invoice: await presentView(ctx.db, ctx.user, await readInvoice(ctx.db, row)) } };
}

export async function issueInvoice(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, "workshop_lead", "house_manager");
  // The hold on the job lasts through the Kill Bill call: a concurrent issue waits, then answers
  // from the job's state.
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  if (!jobActionAllowed("issue_invoice", job.status)) throw conflict("invalid_transition");
  const errors = new FieldErrors();
  if (!ctx.idempotencyKey) errors.add("idempotency_key", "Send an Idempotency-Key header.");
  errors.throwIfAny();

  const sums = await jobTotals(ctx.db, id);
  let killbillInvoiceId: string;
  try {
    const accountId = await accountFor(ctx.db, job.owner_id);
    killbillInvoiceId = await chargeAccount(accountId, sums.total, `Workshop job ${job.number}`);
  } catch (error) {
    if (error instanceof ProviderDown) throw billingUnavailable();
    throw error;
  }
  // Kill Bill has committed the charge: only now does the invoice exist, with the next number.
  const year = zurichParts(new Date()).year;
  const next = await one<{ last: number }>(
    ctx.db,
    `INSERT INTO invoice_numbers (year, last) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last = invoice_numbers.last + 1 RETURNING last`,
    [year],
  );
  const number = `INV-${year}-${String(next?.last ?? 0).padStart(4, "0")}`;
  const invoiceId = newId("i");
  await ctx.db.query(
    `INSERT INTO invoices (id, number, job_id, car_id, owner_id, killbill_invoice_id, lines, net_centimes, vat_centimes,
                           rounding_centimes, total_centimes, issued_at, balance_centimes, status_confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp(), $11, clock_timestamp())`,
    [
      invoiceId, number, id, job.car_id, job.owner_id, killbillInvoiceId, JSON.stringify(sums.lines),
      sums.net.toString(), sums.vat.toString(), sums.rounding.toString(), sums.total.toString(),
    ],
  );
  await ctx.db.query("UPDATE jobs SET status = 'invoiced', version = version + 1 WHERE id = $1", [id]);
  const name = carName({ year: job.car_year, make: job.car_make, model: job.car_model });
  await enqueueEmail(
    ctx.db,
    invoiceIssuedEmail({ owner: { name: job.owner_name, email: job.owner_email }, carName: name, invoiceId, invoiceNumber: number, total: chf(sums.total) }),
  );
  const row = await visibleInvoice(ctx.db, ctx.user, invoiceId);
  const invoice = await presentView(ctx.db, ctx.user, await readInvoice(ctx.db, row));
  return jobReply(ctx.db, ctx.user, id, 201, { invoice });
}

export async function recordTransfer(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleInvoice(ctx.db, ctx.user, id);
  requireRole(ctx.user, "house_manager");
  // Transfers on one invoice run one at a time: the hold lasts through the Kill Bill call.
  const locked = await visibleInvoice(ctx.db, ctx.user, id, true);
  const before = await readInvoice(ctx.db, locked);
  const balance = BigInt(before.row.balance_centimes);
  if (balance === 0n) throw conflict("already_paid");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (reference.length < 1 || reference.length > 60) errors.add("reference", "Enter 1 to 60 characters.");
  const amountText = typeof body.amount === "string" ? body.amount.trim() : typeof body.amount === "number" ? String(body.amount) : "";
  const parsed = /^\d+(\.\d+)?$/.test(amountText) && decimalPlaces(amountText) <= 2 ? parseDecimal(amountText) : null;
  const amount = parsed ? toScaled(parsed, 2) : null;
  if (amount === null || amount < 1n || amount > balance) errors.add("amount", `Enter an amount from 0.01 to ${chf(balance)}.`);
  if (!ctx.idempotencyKey) errors.add("idempotency_key", "Send an Idempotency-Key header.");
  errors.throwIfAny();
  if (!before.live || amount === null) throw billingUnavailable();

  const transferId = newId("t");
  let paymentId: string;
  try {
    const accountId = await accountFor(ctx.db, locked.owner_id);
    paymentId = await recordExternalPayment(accountId, locked.killbill_invoice_id, amount, transferKey(transferId), reference);
  } catch (error) {
    if (error instanceof ProviderDown) throw billingUnavailable();
    throw error;
  }
  await ctx.db.query(
    `INSERT INTO bank_transfers (id, invoice_id, killbill_payment_id, reference, amount_centimes, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [transferId, id, paymentId, reference, amount.toString(), ctx.user.id],
  );
  const after = await readInvoice(ctx.db, locked);
  return { status: 200, body: { invoice: await presentView(ctx.db, ctx.user, after) } };
}
