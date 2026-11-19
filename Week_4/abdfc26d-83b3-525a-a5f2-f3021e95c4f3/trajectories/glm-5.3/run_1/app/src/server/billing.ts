import { vatOf, vatRate } from '../domain.js';
import { one, transaction, type Tx } from './db.js';
import { receiptEmail, invoiceHtml } from './documents.js';
import { queueMail } from './outbox.js';
import { nextInvoiceNumber } from './sequences.js';
import { getOrderTx, getPiece, getPieceTx, writeSaleSplits } from './store.js';
import { renderPdf } from './lib/gotenberg.js';
import { KillBillClient, type KbPayment } from './lib/killbill.js';
import type { StorageLike } from './lib/storage.js';

export interface BillingDeps {
  killbill: KillBillClient;
  storage: StorageLike;
}

export type ConfirmResult = 'confirmed' | 'failed' | 'no_change' | 'unreachable';

/** Re-reads the invoice's payments from Kill Bill and applies only what that read shows. */
export async function confirmOrderPayment(deps: BillingDeps, orderId: string): Promise<ConfirmResult> {
  let invoiceId: string | null = null;
  await transaction(async (tx) => {
    const order = await getOrderTx(tx, orderId);
    if (order && order.state === 'paying') invoiceId = order.killbill_invoice_id;
  });
  if (!invoiceId) return 'no_change';
  let payments: KbPayment[];
  try {
    payments = await deps.killbill.getInvoicePayments(invoiceId);
  } catch {
    return 'unreachable';
  }
  let outcome = 'no_change' as 'confirmed' | 'failed' | 'no_change';
  await transaction(async (tx) => {
    const order = await getOrderTx(tx, orderId);
    if (!order || order.state !== 'paying') return;
    const success = payments.find((p) => paymentSucceeded(p) && paymentAmount(p) >= order.gross_cents);
    const failed = payments.find((p) => paymentFailed(p));
    if (success) {
      await confirmInTx(tx, orderId);
      outcome = 'confirmed';
    } else if (failed) {
      await tx.query(`UPDATE orders SET state = 'failed' WHERE id = $1 AND state = 'paying'`, [orderId]);
      outcome = 'failed';
    }
  });
  if (outcome === 'confirmed') {
    await renderInvoiceForOrder(deps, orderId);
  }
  return outcome;
}

async function confirmInTx(tx: Tx, orderId: string): Promise<void> {
  const order = await getOrderTx(tx, orderId);
  if (!order || order.state !== 'paying') return;
  const piece = await getPieceTx(tx, order.piece_slug);
  if (!piece) throw new Error('piece_missing');
  const now = new Date();
  const invoiceNumber = await nextInvoiceNumber(tx, now);
  const updated = await tx.query<{ id: string }>(
    `UPDATE orders SET state = 'paid', paid_at = $2, invoice_number = $3, invoice_status = 'pending'
     WHERE id = $1 AND state = 'paying' RETURNING id`,
    [orderId, now, invoiceNumber]
  );
  if (updated.length === 0) throw new Error('confirm_raced');
  await writeSaleSplits(tx, orderId, piece, order.net_cents);
}

/** Renders and stores the invoice PDF, then moves paid -> invoiced and queues the receipt. */
export async function renderInvoiceForOrder(deps: BillingDeps, orderId: string): Promise<boolean> {
  const current = await transaction(async (tx) => getOrderTx(tx, orderId));
  if (!current || !current.invoice_number) return false;
  if (current.invoice_status === 'ready') return true;
  const piece = await getPiece(current.piece_slug);
  const seller = await getSellerAddress(piece?.creator_id ?? '');
  const html = invoiceHtml({
    invoice_number: current.invoice_number,
    issue_date: (current.paid_at ?? new Date()).toISOString().slice(0, 10),
    seller_name: piece?.creator_name ?? 'Phosphene Yard',
    seller_address: seller,
    buyer_name: current.billing_name,
    buyer_email: current.email,
    buyer_country: current.billing_country,
    piece_title: current.piece_title,
    edition: current.edition,
    edition_count: current.edition_count,
    net_cents: current.net_cents,
    vat_rate: current.vat_rate_percent,
    vat_cents: current.vat_cents,
    gross_cents: current.gross_cents
  });
  let pdf: Buffer;
  try {
    pdf = await renderPdf(html);
  } catch {
    return false;
  }
  const year = (current.paid_at ?? new Date()).getUTCFullYear();
  await deps.storage.put(`invoices/${year}/${current.invoice_number}.pdf`, pdf, 'application/pdf');
  const pdfBase64 = pdf.toString('base64');
  await transaction(async (tx) => {
    const order = await getOrderTx(tx, orderId);
    if (!order || order.invoice_status === 'ready') return;
    if (order.state === 'paid') {
      await tx.query(`UPDATE orders SET invoice_status = 'ready', state = 'invoiced', receipt_status = 'queued' WHERE id = $1`, [orderId]);
      const email = receiptEmail(order.piece_title, order.edition, order.edition_count, order.invoice_number!, pdfBase64);
      email.to = order.email;
      await queueMail(tx, 'receipt', email);
    } else {
      // Seed orders keep their state (receipted) and queue no receipt.
      await tx.query(`UPDATE orders SET invoice_status = 'ready' WHERE id = $1`, [orderId]);
    }
  });
  return true;
}

async function getSellerAddress(userId: string): Promise<string> {
  const row = await one<{ seller_address: string | null }>(`SELECT seller_address FROM users WHERE id = $1`, [userId]);
  return row?.seller_address ?? '';
}

/** Polling loop body: re-checks paying orders against Kill Bill. */
export async function pollPayingOrders(deps: BillingDeps): Promise<void> {
  const rows = await transaction(async (tx) => tx.query<{ id: string }>(`SELECT id FROM orders WHERE state = 'paying' ORDER BY created_at`));
  for (const row of rows) {
    await confirmOrderPayment(deps, row.id).catch(() => null);
  }
}

export async function pollPendingPlans(deps: BillingDeps): Promise<void> {
  const plans = await transaction(async (tx) =>
    tx.query<{ user_id: string; killbill_account_id: string | null; killbill_subscription_id: string | null; code: string; state: string }>(
      `SELECT user_id, killbill_account_id, killbill_subscription_id, code, state FROM plans WHERE state IN ('pending_payment', 'cancelling')`
    )
  );
  for (const plan of plans) {
    if (!plan.killbill_account_id) continue;
    try {
      const invoices = await deps.killbill.accountInvoices(plan.killbill_account_id);
      for (const invoice of invoices) {
        // A subscription invoice carries an item naming this plan's subscription.
        const detail = await deps.killbill.getInvoice(invoice.invoiceId);
        if (!detail?.items?.some((item) => item.subscriptionId === plan.killbill_subscription_id)) continue;
        const payments = await deps.killbill.getInvoicePayments(invoice.invoiceId);
        const paid = payments.some((p) => paymentSucceeded(p));
        if (!paid) continue;
        await transaction(async (tx) => {
          await applySubscriptionInvoice(tx, plan.user_id, plan.code, invoice.invoiceId);
        });
      }
      if (plan.state === 'cancelling') {
        await transaction(async (tx) => {
          const row = await tx.one<{ ends_on: string | null }>(`SELECT ends_on::text AS ends_on FROM plans WHERE user_id = $1`, [plan.user_id]);
          if (row?.ends_on && new Date(row.ends_on).getTime() <= Date.now()) {
            await tx.query(`UPDATE plans SET state = 'ended' WHERE user_id = $1 AND state = 'cancelling'`, [plan.user_id]);
          }
        });
      }
    } catch {
      // Kill Bill unreachable; the next poll retries.
    }
  }
}

/** Grants plan credits once per subscription invoice and activates a pending plan. */
export async function applySubscriptionInvoice(tx: Tx, userId: string, planCode: string, invoiceId: string): Promise<void> {
  const seen = await tx.one<{ subscription_invoice_id: string }>(
    `SELECT subscription_invoice_id FROM plan_invoices WHERE subscription_invoice_id = $1 FOR UPDATE`,
    [invoiceId]
  );
  if (seen) return;
  const credits = planCode === 'pro-monthly' ? 1500 : 300;
  await tx.query(`INSERT INTO plan_invoices (subscription_invoice_id, plan_user_id, credits) VALUES ($1,$2,$3)`, [invoiceId, userId, credits]);
  const entry = await tx.one<{ id: string }>(`INSERT INTO credit_entries (kind, render_id) VALUES ('grant', NULL) RETURNING id::text`);
  if (!entry) return;
  await tx.query(`INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1,'platform:issued',$2), ($1,$3,$4)`,
    [entry.id, -credits, `creator:${userId}:available`, credits]);
  await tx.query(`UPDATE plans SET state = 'active' WHERE user_id = $1 AND state = 'pending_payment'`, [userId]);
}

export async function pollPendingPacks(deps: BillingDeps): Promise<void> {
  const packs = await transaction(async (tx) =>
    tx.query<{ id: string; user_id: string; killbill_invoice_id: string | null }>(
      `SELECT id, user_id, killbill_invoice_id FROM credit_packs WHERE state = 'paying'`
    )
  );
  for (const pack of packs) {
    if (!pack.killbill_invoice_id) continue;
    try {
      const payments = await deps.killbill.getInvoicePayments(pack.killbill_invoice_id);
      const paid = payments.some((p) => paymentSucceeded(p));
      const failed = payments.some((p) => p.transactions?.some((t) => t.status === 'PAYMENT_FAILURE'));
      if (!paid && !failed) continue;
      await transaction(async (tx) => {
        if (paid) {
          const entry = await tx.one<{ id: string }>(`INSERT INTO credit_entries (kind, render_id) VALUES ('pack', NULL) RETURNING id::text`);
          if (!entry) return;
          await tx.query(`INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1,'platform:issued',$2), ($1,$3,$4)`,
            [entry.id, -500, `creator:${pack.user_id}:available`, 500]);
          await tx.query(`UPDATE credit_packs SET state = 'paid' WHERE id = $1`, [pack.id]);
        } else {
          await tx.query(`UPDATE credit_packs SET state = 'failed' WHERE id = $1`, [pack.id]);
        }
      });
    } catch {
      // Kill Bill unreachable; the next poll retries.
    }
  }
}

export function paymentSucceeded(payment: KbPayment): boolean {
  return payment.transactions?.some((t) => t.status === 'SUCCESS') ?? false;
}

export function paymentFailed(payment: KbPayment): boolean {
  return payment.transactions?.some((t) => t.status === 'PAYMENT_FAILURE') ?? false;
}

export function paymentAmount(payment: KbPayment): number {
  return Math.round((payment.purchasedAmount ?? payment.amount ?? 0) * 100);
}

export function vatForOrder(netCents: number, country: string): { vat_rate_percent: number; vat_cents: number; gross_cents: number } {
  const rate = vatRate(country);
  const vat = vatOf(netCents, rate);
  return { vat_rate_percent: rate, vat_cents: vat, gross_cents: netCents + vat };
}

export function killbillChargeDescription(pieceTitle: string, edition: number, editionCount: number): string {
  return `${pieceTitle} — edition ${edition} of ${editionCount}`;
}
