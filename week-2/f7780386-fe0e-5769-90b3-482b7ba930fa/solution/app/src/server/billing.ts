// Kill Bill: one account per member, external charges, PURCHASE payments and credits over its REST API,
// with charges, payments and credits that cannot be made now queued in PostgreSQL and retried.

import { createHash, randomUUID } from "node:crypto";
import type { BillingState, Invoice } from "../shared/api.js";
import { formatMoney } from "../shared/rules.js";
import { now } from "./clock.js";
import type { Config } from "./config.js";
import { tx, type Db } from "./db.js";
import { unavailable } from "./errors.js";
import { enqueueInvoiceNotice, kickMail } from "./mail.js";

let settings: Config["killbill"] | null = null;
let target = "";
let reachable = false;

export function configureBilling(killbill: Config["killbill"]): void {
  settings = killbill;
  target = createHash("sha256").update(`${killbill.url}\n${killbill.apiKey}`).digest("hex").slice(0, 24);
}

export function billingState(): BillingState {
  return reachable ? "up" : "down";
}

class BillingUnreachable extends Error {}

interface KillBillReply {
  status: number;
  body: unknown;
  location: string | null;
}

const cents = (amount: unknown): number => Math.round(Number(amount) * 100);
const dollars = (amountCents: number): number => amountCents / 100;

async function killbill(method: "GET" | "POST", path: string, body?: unknown): Promise<KillBillReply> {
  const kb = settings;
  if (!kb) throw new BillingUnreachable("billing not configured");
  let response: Response;
  try {
    response = await fetch(`${kb.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${kb.username}:${kb.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": kb.apiKey,
        "X-Killbill-ApiSecret": kb.apiSecret,
        "X-Killbill-CreatedBy": "passboard",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    reachable = false;
    throw new BillingUnreachable("Kill Bill unreachable");
  }
  if (response.status >= 500 || response.status === 401 || response.status === 403) {
    reachable = false;
    throw new BillingUnreachable(`Kill Bill answered ${response.status}`);
  }
  reachable = true;
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed, location: response.headers.get("location") };
}

function expect2xx(reply: KillBillReply, what: string): void {
  if (reply.status < 200 || reply.status > 299) throw new Error(`Kill Bill ${what} answered ${reply.status}`);
}

/** Reuses the member's Kill Bill account (external key = member id) or creates it. */
async function accountFor(db: Db, memberId: string): Promise<string> {
  const known = await db.query<{ killbill_account_id: string }>("SELECT killbill_account_id FROM billing_accounts WHERE member_id = $1", [memberId]);
  const cached = known.rows[0]?.killbill_account_id;
  if (cached) return cached;
  let accountId = await accountByKey(memberId);
  if (!accountId) {
    const member = await db.query<{ business_name: string; contact_email: string }>("SELECT business_name, contact_email FROM members WHERE id = $1", [memberId]);
    const row = member.rows[0];
    if (!row) throw new Error(`member ${memberId} missing`);
    const created = await killbill("POST", "/accounts", { name: row.business_name, email: row.contact_email, currency: "USD", externalKey: memberId });
    accountId = created.status === 201 ? (created.location?.split("/").filter(Boolean).pop() ?? null) : await accountByKey(memberId);
    if (!accountId) throw new Error(`Kill Bill account creation answered ${created.status}`);
  }
  await db.query("INSERT INTO billing_accounts (member_id, killbill_account_id) VALUES ($1, $2) ON CONFLICT (member_id) DO NOTHING", [memberId, accountId]);
  return accountId;
}

async function accountByKey(memberId: string): Promise<string | null> {
  const found = await killbill("GET", `/accounts?externalKey=${encodeURIComponent(memberId)}`);
  if (found.status === 404) return null;
  expect2xx(found, "account lookup");
  return (found.body as { accountId: string }).accountId;
}

/** An external charge on the account; returns the invoice it landed on. */
async function charge(accountId: string, amountCents: number, description: string): Promise<string> {
  const reply = await killbill("POST", `/invoices/charges/${accountId}?autoCommit=true`, [
    { accountId, amount: dollars(amountCents), currency: "USD", description },
  ]);
  expect2xx(reply, "external charge");
  const items = reply.body as { invoiceId: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new Error("Kill Bill external charge returned no invoice");
  return invoiceId;
}

/** A successful external PURCHASE payment of an invoice. */
async function payInvoice(accountId: string, invoiceId: string, amountCents: number): Promise<void> {
  const reply = await killbill("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, { accountId, purchasedAmount: dollars(amountCents) });
  expect2xx(reply, "invoice payment");
}

async function credit(accountId: string, amountCents: number, description: string): Promise<void> {
  const reply = await killbill("POST", "/credits?autoCommit=true", [{ accountId, amount: dollars(amountCents), currency: "USD", description }]);
  expect2xx(reply, "credit");
}

/** Pack purchase: the charge and its payment are recorded in Kill Bill before the hours are written. */
export async function chargeAndPayPack(memberId: string, priceCents: number, packName: string): Promise<string> {
  try {
    const accountId = await tx((db) => accountFor(db, memberId));
    const invoiceId = await charge(accountId, priceCents, packName);
    await payInvoice(accountId, invoiceId, priceCents);
    return invoiceId;
  } catch (error) {
    if (error instanceof BillingUnreachable) throw unavailable("billing_unavailable");
    throw error;
  }
}

type JobKind = "overage_charge" | "fee_charge" | "fee_waiver_credit" | "overage_refund_credit";

export async function enqueueBilling(db: Db, kind: JobKind, memberId: string, bookingId: string, amountCents: number, description: string): Promise<string> {
  const id = `bjob_${randomUUID().replaceAll("-", "")}`;
  await db.query(
    `INSERT INTO billing_jobs (id, target, kind, member_id, booking_id, amount_cents, description, state, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)`,
    [id, target, kind, memberId, bookingId, amountCents, description, new Date(now())],
  );
  return id;
}

/** Drops a still-queued job so it never reaches Kill Bill; returns the job if one was dropped. */
export async function dropQueued(db: Db, bookingId: string, kind: JobKind): Promise<{ killbill_invoice_id: string | null } | null> {
  const dropped = await db.query<{ killbill_invoice_id: string | null }>(
    "UPDATE billing_jobs SET state = 'dropped' WHERE booking_id = $1 AND kind = $2 AND state = 'queued' RETURNING killbill_invoice_id",
    [bookingId, kind],
  );
  return dropped.rows[0] ?? null;
}

interface JobRow {
  id: string;
  kind: JobKind;
  member_id: string;
  booking_id: string;
  amount_cents: number;
  description: string;
  killbill_invoice_id: string | null;
}

/** Records one queued job in Kill Bill. The booking row is locked first, as cancellation and waivers do. */
async function processJob(jobId: string, bookingId: string): Promise<void> {
  await tx(async (db) => {
    await db.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [bookingId]);
    const locked = await db.query<JobRow>(
      `SELECT id, kind, member_id, booking_id, amount_cents, description, killbill_invoice_id
         FROM billing_jobs WHERE id = $1 AND state = 'queued' FOR UPDATE SKIP LOCKED`,
      [jobId],
    );
    const job = locked.rows[0];
    if (!job) return;
    const accountId = await accountFor(db, job.member_id);
    if (job.kind === "overage_charge") {
      let invoiceId = job.killbill_invoice_id;
      if (!invoiceId) {
        invoiceId = await charge(accountId, job.amount_cents, job.description);
        await db.query("UPDATE billing_jobs SET killbill_invoice_id = $2 WHERE id = $1", [job.id, invoiceId]);
        await enqueueInvoiceNotice(db, job.member_id, job.id, job.amount_cents, job.description);
      }
      try {
        await payInvoice(accountId, invoiceId, job.amount_cents);
      } catch (error) {
        if (error instanceof BillingUnreachable) return;
        throw error;
      }
      await db.query("UPDATE bookings SET payment = 'paid' WHERE id = $1 AND payment = 'payment_pending'", [job.booking_id]);
    } else if (job.kind === "fee_charge") {
      await charge(accountId, job.amount_cents, job.description);
      await db.query("UPDATE bookings SET fee_status = 'charged' WHERE id = $1 AND fee_status = 'pending'", [job.booking_id]);
      await enqueueInvoiceNotice(db, job.member_id, job.id, job.amount_cents, job.description);
    } else {
      await credit(accountId, job.amount_cents, job.description);
    }
    await db.query("UPDATE billing_jobs SET state = 'done' WHERE id = $1", [job.id]);
  });
}

/** Records the given jobs now when billing is reachable; anything left stays queued for the retry loop. */
export async function settleNow(jobIds: { id: string; bookingId: string }[]): Promise<void> {
  if (!reachable) return;
  for (const job of jobIds) {
    try {
      await processJob(job.id, job.bookingId);
    } catch {
      break;
    }
  }
  kickMail();
}

let settling = false;

/** Probes Kill Bill and records everything still queued for it. Runs every few seconds. */
export async function settleQueued(): Promise<void> {
  if (settling || !settings) return;
  settling = true;
  try {
    // Reachable means Kill Bill answers at all: its healthcheck also fails on internal queue growth while
    // its API keeps working, and any call that does fail leaves its work queued for the next pass.
    try {
      await fetch(`${settings.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(5000) });
      reachable = true;
    } catch {
      reachable = false;
    }
    if (!reachable) return;
    const queued = await tx((db) =>
      db.query<{ id: string; booking_id: string }>("SELECT id, booking_id FROM billing_jobs WHERE state = 'queued' AND target = $1 ORDER BY created_at LIMIT 100", [target]),
    );
    await settleNow(queued.rows.map((row) => ({ id: row.id, bookingId: row.booking_id })));
  } finally {
    settling = false;
  }
}

interface KillBillInvoice {
  invoiceId: string;
  accountId: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items: { description: string | null; amount: number }[];
}

function invoiceJson(invoice: KillBillInvoice): Invoice {
  return {
    id: invoice.invoiceId,
    date: invoice.invoiceDate,
    amount: formatMoney(cents(invoice.amount)),
    balance: formatMoney(cents(invoice.balance)),
    items: invoice.items.map((item) => ({ description: item.description ?? "", amount: formatMoney(cents(item.amount)) })),
  };
}

async function readInvoice(invoiceId: string): Promise<KillBillInvoice | null> {
  const reply = await killbill("GET", `/invoices/${encodeURIComponent(invoiceId)}?withChildrenItems=false&audit=NONE`);
  if (reply.status === 404 || reply.status === 400) return null;
  expect2xx(reply, "invoice read");
  return reply.body as KillBillInvoice;
}

async function knownAccount(db: Db, memberId: string): Promise<string | null> {
  const known = await db.query<{ killbill_account_id: string }>("SELECT killbill_account_id FROM billing_accounts WHERE member_id = $1", [memberId]);
  return known.rows[0]?.killbill_account_id ?? (await accountByKey(memberId));
}

/** The member's invoices with their line items, newest first, read from Kill Bill. */
export async function memberInvoices(db: Db, memberId: string): Promise<Invoice[]> {
  try {
    const accountId = await knownAccount(db, memberId);
    if (!accountId) return [];
    const list = await killbill("GET", `/accounts/${accountId}/invoices?audit=NONE`);
    expect2xx(list, "invoice list");
    const invoices: Invoice[] = [];
    for (const summary of (list.body as { invoiceId: string }[]).reverse()) {
      const invoice = await readInvoice(summary.invoiceId);
      if (invoice) invoices.push(invoiceJson(invoice));
    }
    return invoices;
  } catch (error) {
    if (error instanceof BillingUnreachable) throw unavailable("billing_unavailable");
    throw error;
  }
}

/** One invoice, only when it is on the given member's account. */
export async function memberInvoice(db: Db, memberId: string, invoiceId: string): Promise<Invoice | null> {
  try {
    const accountId = await knownAccount(db, memberId);
    if (!accountId) return null;
    const invoice = await readInvoice(invoiceId);
    return invoice && invoice.accountId === accountId ? invoiceJson(invoice) : null;
  } catch (error) {
    if (error instanceof BillingUnreachable) throw unavailable("billing_unavailable");
    throw error;
  }
}

/** Which member owns a Kill Bill account, for the operator's invoice reads. */
export async function invoiceOwner(db: Db, invoiceId: string): Promise<string | null> {
  try {
    const invoice = await readInvoice(invoiceId);
    if (!invoice) return null;
    const owner = await db.query<{ member_id: string }>("SELECT member_id FROM billing_accounts WHERE killbill_account_id = $1", [invoice.accountId]);
    return owner.rows[0]?.member_id ?? null;
  } catch (error) {
    if (error instanceof BillingUnreachable) throw unavailable("billing_unavailable");
    throw error;
  }
}
