// Milestone invoices: drafting, issuing to Kill Bill, card payments, declines, and the overdue rule.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config.js";
import { one, pool, rows, transaction, type Db } from "../db.js";
import { ApiError } from "../errors.js";
import * as killbill from "../killbill.js";
import { queueEmail, queuePush } from "../outbox.js";
import type { Currency } from "../../shared/money.js";
import { MILESTONE_LABELS, type Milestone } from "../../shared/format.js";
import { checkCard } from "./cards.js";
import { contactEmail, loadEngagement, type EngagementRow } from "./engagements.js";
import { invoiceIssued, invoiceReceipt, overdueNotice, overduePush, paymentFailed, type InvoiceFacts, type NoticeContext } from "./notices.js";
import { changeOrderAmount } from "./pricing.js";
import { catalogueFor, readQuote } from "./quote.js";
import type { ReviewMilestone } from "./states.js";

type InvoiceStatus = "draft" | "issued" | "paid" | "payment_failed" | "overdue" | "void";
type InvoiceRow = {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  status: InvoiceStatus;
  number: string | null;
  killbill_invoice_id: string | null;
  failed_attempts: number;
  issued_at: Date | null;
  overdue_at: Date | null;
  currency: Currency;
};
type Invoice = {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  number: string | null;
  status: InvoiceStatus;
  lines: { description: string; amount_minor: number }[];
  amount_minor: number;
  balance_minor: number;
  currency: Currency;
  killbill_invoice_id: string | null;
  failed_attempts: number;
  issued_at: string | null;
  overdue_at: string | null;
};

const MILESTONE_ORDER: Milestone[] = ["deposit", "look_dev", "final_delivery"];
const PAYABLE: InvoiceStatus[] = ["issued", "payment_failed", "overdue"];
const SELECT_INVOICE = `SELECT i.id, i.engagement_id, i.milestone, i.status, i.number, i.killbill_invoice_id, i.failed_attempts, i.issued_at, i.overdue_at, b.currency
  FROM invoices i JOIN engagements e ON e.id = i.engagement_id JOIN brands b ON b.id = e.brand_id`;

/** Emails written outside a request (the overdue check) link to APP_PUBLIC_URL, or this host when it is unset. */
const defaultOrigin = (): string => config.publicUrl ?? `http://localhost:${config.port}`;

/** A payment_failed invoice is due to go overdue strictly after its overdue_at; at exactly overdue_at it is not. */
function pastDue(row: { status: InvoiceStatus; overdue_at: Date | null }, now: Date): boolean {
  return row.status === "payment_failed" && row.overdue_at !== null && now.getTime() > row.overdue_at.getTime();
}

async function linesOf(db: Db, invoiceId: string): Promise<{ description: string; amount_minor: number }[]> {
  return rows(db, "SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY position", [invoiceId]);
}

async function toInvoice(db: Db, row: InvoiceRow): Promise<Invoice> {
  const lines = await linesOf(db, row.id);
  const amount = lines.reduce((sum, line) => sum + line.amount_minor, 0);
  const settled = row.status === "paid" || row.status === "void";
  return {
    id: row.id,
    engagement_id: row.engagement_id,
    milestone: row.milestone,
    number: row.number,
    status: row.status,
    lines,
    amount_minor: amount,
    balance_minor: settled ? 0 : amount,
    currency: row.currency,
    killbill_invoice_id: row.killbill_invoice_id,
    failed_attempts: row.failed_attempts,
    issued_at: row.issued_at ? row.issued_at.toISOString() : null,
    overdue_at: row.overdue_at && !settled ? row.overdue_at.toISOString() : null,
  };
}

export async function invoicesOf(db: Db, engagementId: string): Promise<Invoice[]> {
  const list = await rows<InvoiceRow>(db, `${SELECT_INVOICE} WHERE i.engagement_id = $1`, [engagementId]);
  list.sort((a, b) => MILESTONE_ORDER.indexOf(a.milestone) - MILESTONE_ORDER.indexOf(b.milestone));
  return Promise.all(list.map((row) => toInvoice(db, row)));
}

async function loadInvoice(db: Db, invoiceId: string, brandId: string | null, lock = false): Promise<InvoiceRow> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new ApiError("not_found");
  const row = await one<InvoiceRow>(db, `${SELECT_INVOICE} WHERE i.id = $1${brandId ? " AND e.brand_id = $2" : ""}${lock ? " FOR NO KEY UPDATE OF i" : ""}`, brandId ? [invoiceId, brandId] : [invoiceId]);
  if (!row) throw new ApiError("not_found");
  return row;
}

/** The facts every money email and PDF needs: the locked quote, the brand and the engagement link. */
export async function noticeContext(db: Db, engagement: EngagementRow, origin: string, now: Date): Promise<NoticeContext> {
  return {
    reference: engagement.reference,
    brandName: engagement.brand_name,
    currency: engagement.currency,
    quote: await readQuote(db, engagement, await catalogueFor(engagement), now),
    engagementUrl: `${origin}/account/engagements/${engagement.id}`,
  };
}

const facts = (invoice: Invoice): InvoiceFacts => ({ number: invoice.number ?? "", milestone: invoice.milestone, lines: invoice.lines, amount_minor: invoice.amount_minor });

/** A client's view of one invoice: only issued invoices exist for clients. */
export async function clientInvoice(brandId: string, invoiceId: string, now: Date): Promise<Invoice> {
  const row = await loadInvoice(pool, invoiceId, brandId);
  if (row.issued_at === null) throw new ApiError("not_found");
  await settleOverdue(row.engagement_id, now);
  return toInvoice(pool, await loadInvoice(pool, invoiceId, brandId));
}

/** Accepting a milestone drafts its invoice: the share line plus one change-order line per round from the third. */
export async function draftInvoice(client: pg.PoolClient, engagement: EngagementRow, milestone: ReviewMilestone, now: Date): Promise<void> {
  const quote = await readQuote(client, engagement, await catalogueFor(engagement), now);
  const share = milestone === "look_dev" ? quote.milestones.look_dev_minor : quote.milestones.final_delivery_minor;
  const rounds = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM revision_rounds WHERE engagement_id = $1 AND milestone = $2", [engagement.id, milestone]);
  const lines = [{ description: `${MILESTONE_LABELS[milestone]} ${engagement.reference}`, amount_minor: share }];
  for (let round = 3; round <= (rounds?.n ?? 0); round++) {
    lines.push({ description: `Change order, ${MILESTONE_LABELS[milestone]} round ${round}, ${engagement.reference}`, amount_minor: changeOrderAmount(quote.fx_rate, engagement.currency) });
  }
  const id = randomUUID();
  const inserted = await one(client, "INSERT INTO invoices (id, engagement_id, milestone, status) VALUES ($1, $2, $3, 'draft') ON CONFLICT DO NOTHING RETURNING id", [id, engagement.id, milestone]);
  if (!inserted) return;
  for (const [position, line] of lines.entries()) {
    await client.query("INSERT INTO invoice_lines (invoice_id, position, description, amount_minor) VALUES ($1, $2, $3, $4)", [id, position, line.description, line.amount_minor]);
  }
}

/** Records the deposit invoice, issued and paid at the deposit moment. */
export async function recordDepositInvoice(
  client: pg.PoolClient,
  engagementId: string,
  reference: string,
  depositMinor: number,
  kb: { invoiceId: string; number: string },
  at: Date,
): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO invoices (id, engagement_id, milestone, status, number, killbill_invoice_id, issued_at) VALUES ($1, $2, 'deposit', 'paid', $3, $4, $5)", [
    id,
    engagementId,
    kb.number,
    kb.invoiceId,
    at,
  ]);
  await client.query("INSERT INTO invoice_lines (invoice_id, position, description, amount_minor) VALUES ($1, 0, $2, $3)", [id, `Deposit ${reference}`, depositMinor]);
  return id;
}

export async function invoiceById(db: Db, invoiceId: string): Promise<Invoice> {
  return toInvoice(db, await loadInvoice(db, invoiceId, null));
}

async function brandAccount(db: Db, brandId: string): Promise<{ account: string | null; financeEmail: string }> {
  const brand = await one<{ killbill_account_id: string | null }>(db, "SELECT killbill_account_id FROM brands WHERE id = $1", [brandId]);
  return { account: brand?.killbill_account_id ?? null, financeEmail: await contactEmail(db, brandId, "finance") };
}

/** Issuing posts the draft to Kill Bill once (a retry adopts an invoice an interrupted attempt created) and queues its email. */
export async function issueInvoice(invoiceId: string, origin: string, now: Date): Promise<Invoice> {
  return transaction(async (client) => {
    const row = await loadInvoice(client, invoiceId, null, true);
    if (row.status !== "draft") throw new ApiError("invalid_state");
    const engagement = await loadEngagement(client, row.engagement_id, null);
    const invoice = await toInvoice(client, row);
    const { financeEmail } = await brandAccount(client, engagement.brand_id);
    const account = await killbill.ensureAccount({ id: engagement.brand_id, name: engagement.brand_name, currency: engagement.currency }, financeEmail);
    const share = invoice.lines[0]?.description ?? "";
    const adopted = (await killbill.accountInvoices(account)).find((kb) => kb.status !== "VOID" && kb.items.some((item) => item.description === share));
    const kbInvoiceId = adopted?.invoiceId ?? (await killbill.createChargeInvoice(account, engagement.currency, invoice.lines));
    const kbInvoice = await killbill.getInvoice(kbInvoiceId);
    await client.query("UPDATE invoices SET status = 'issued', number = $2, killbill_invoice_id = $3, issued_at = $4 WHERE id = $1", [row.id, String(kbInvoice.invoiceNumber), kbInvoiceId, now]);
    await client.query("UPDATE brands SET killbill_account_id = $2 WHERE id = $1", [engagement.brand_id, account]);
    const issued = await toInvoice(client, await loadInvoice(client, invoiceId, null));
    await queueEmail(client, invoiceIssued(await noticeContext(client, engagement, origin, now), financeEmail, facts(issued)));
    return issued;
  });
}

/** Clears the brand's OVERDUE blocking state once it has no overdue invoice left. */
export async function clearBlockIfDone(client: pg.PoolClient, brandId: string): Promise<void> {
  const brand = await one<{ killbill_account_id: string | null; overdue_blocked: boolean }>(client, "SELECT killbill_account_id, overdue_blocked FROM brands WHERE id = $1 FOR NO KEY UPDATE", [brandId]);
  if (!brand?.overdue_blocked || !brand.killbill_account_id) return;
  const overdue = await one(client, "SELECT 1 FROM invoices i JOIN engagements e ON e.id = i.engagement_id WHERE e.brand_id = $1 AND i.status = 'overdue' LIMIT 1", [brandId]);
  if (overdue) return;
  await killbill.setOverdueBlock(brand.killbill_account_id, false);
  await client.query("UPDATE brands SET overdue_blocked = false WHERE id = $1", [brandId]);
}


type PayOutcome = { declined: true } | { declined: false; invoice: Invoice; ledgerEntry: Record<string, unknown> };

/** Pays an issued, failed or overdue invoice by card: Paid only once Kill Bill records the payment and a zero balance. */
export async function payInvoice(brandId: string, invoiceId: string, body: Record<string, unknown>, origin: string, now: Date): Promise<{ status: number; body: unknown }> {
  const outcome = await transaction<PayOutcome>(async (client) => {
    const row = await loadInvoice(client, invoiceId, brandId, true);
    if (!PAYABLE.includes(row.status)) throw new ApiError("invoice_not_payable");
    const card = checkCard(body.card, now);
    const engagement = await loadEngagement(client, row.engagement_id, brandId);
    const invoice = await toInvoice(client, row);
    const { account, financeEmail } = await brandAccount(client, engagement.brand_id);
    const context = await noticeContext(client, engagement, origin, now);
    if (!card.approves) {
      const overdueAt = row.overdue_at ?? new Date(now.getTime() + config.timers.overdueAfter * 1000);
      await client.query("UPDATE invoices SET failed_attempts = failed_attempts + 1, status = CASE WHEN status = 'issued' THEN 'payment_failed' ELSE status END, overdue_at = $2 WHERE id = $1", [
        row.id,
        overdueAt,
      ]);
      await queueEmail(client, paymentFailed(context, financeEmail, facts(invoice), overdueAt.toISOString()));
      return { declined: true };
    }
    if (!account || !row.killbill_invoice_id) throw new ApiError("billing_unavailable");
    const paymentId = await killbill.payInvoice(account, row.killbill_invoice_id, engagement.currency, invoice.balance_minor);
    const confirmed = await killbill.getInvoice(row.killbill_invoice_id);
    if (confirmed.balance !== 0) throw new ApiError("billing_unavailable");
    await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [row.id]);
    const entryId = randomUUID();
    const entry = await one<Record<string, unknown> & { created_at: Date }>(
      client,
      `INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id)
       VALUES ($1, $2, 'invoice_payment', $3, $4, $5, $6) RETURNING id, kind, amount_minor, currency, invoice_id, killbill_payment_id, created_at`,
      [entryId, engagement.id, invoice.amount_minor, engagement.currency, row.id, paymentId],
    );
    await queueEmail(client, invoiceReceipt(context, financeEmail, facts(invoice)));
    if (row.status === "overdue") await clearBlockIfDone(client, engagement.brand_id).catch(() => undefined);
    const paid = await toInvoice(client, await loadInvoice(client, invoiceId, brandId));
    return { declined: false, invoice: paid, ledgerEntry: { ...entry, created_at: entry?.created_at.toISOString() } };
  });
  if (outcome.declined) throw new ApiError("card_declined");
  return { status: 201, body: { invoice: outcome.invoice, ledger_entry: outcome.ledgerEntry } };
}

/** Makes one past-due invoice overdue, but only once Kill Bill confirms the brand's OVERDUE blocking state. */
async function goOverdue(invoiceId: string, now: Date): Promise<void> {
  await transaction(async (client) => {
    const row = await one<InvoiceRow>(client, `${SELECT_INVOICE} WHERE i.id = $1 FOR UPDATE OF i SKIP LOCKED`, [invoiceId]);
    if (!row || !pastDue(row, now)) return;
    const engagement = await loadEngagement(client, row.engagement_id, null);
    const { account, financeEmail } = await brandAccount(client, engagement.brand_id);
    if (!account) return;
    await killbill.setOverdueBlock(account, true);
    await client.query("UPDATE invoices SET status = 'overdue' WHERE id = $1", [row.id]);
    await client.query("UPDATE brands SET overdue_blocked = true WHERE id = $1", [engagement.brand_id]);
    const invoice = await toInvoice(client, { ...row, status: "overdue" });
    const context = await noticeContext(client, engagement, defaultOrigin(), now);
    await queueEmail(client, overdueNotice(context, financeEmail, facts(invoice)));
    await queuePush(client, overduePush(context, facts(invoice)));
  });
}

/** Decides overdue for one engagement's invoices on every read; an unreachable Kill Bill leaves them payment_failed. */
export async function settleOverdue(engagementId: string, now: Date): Promise<void> {
  const due = await rows<{ id: string }>(pool, "SELECT id FROM invoices WHERE engagement_id = $1 AND status = 'payment_failed' AND overdue_at < $2", [engagementId, now]);
  for (const { id } of due) await goOverdue(id, now).catch(() => undefined);
}

/** The background check: every past-due invoice, and any brand whose block can be cleared. */
export function startOverdueCheck(): void {
  const sweep = async (): Promise<void> => {
    const now = new Date();
    const due = await rows<{ id: string }>(pool, "SELECT id FROM invoices WHERE status = 'payment_failed' AND overdue_at < $1", [now]);
    for (const { id } of due) await goOverdue(id, now).catch(() => undefined);
    const blocked = await rows<{ id: string }>(pool, "SELECT id FROM brands WHERE overdue_blocked");
    for (const { id } of blocked) await transaction((client) => clearBlockIfDone(client, id)).catch(() => undefined);
  };
  setInterval(() => void sweep().catch(() => undefined), 5_000).unref();
}

