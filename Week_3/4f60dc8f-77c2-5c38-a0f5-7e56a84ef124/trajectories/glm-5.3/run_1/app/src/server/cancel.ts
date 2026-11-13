import type { App } from './app';
import { ApiError } from './errors';
import { newId, loadEngagementRow } from './domain';
import { brandFinanceEmail, shareLineDescription, escapeHtml, invoiceHtml } from './billing';
import { formatMoney, CURRENCIES } from './money';
import type { EngagementRow } from './domain';
import type { CurrencyCode } from './types';

/**
 * Cancellation and refund. The refund allocation (newest payment first),
 * the refund transaction key format and void handling live here.
 */

export interface ConfirmedPayment {
  ledgerEntryId: string;
  killbillPaymentId: string;
  amountMinor: number;
  invoiceId: string | null;
  createdAt: Date;
  refundedMinor: number;
}

export async function loadConfirmedPayments(app: App, engagementId: string): Promise<ConfirmedPayment[]> {
  const result = await app.pool.query(
    `SELECT * FROM ledger_entries
     WHERE engagement_id = $1 AND kind IN ('deposit','invoice_payment')
     ORDER BY created_at DESC, id DESC`,
    [engagementId],
  );
  const refunds = await app.pool.query(
    `SELECT killbill_payment_id, COALESCE(SUM(amount_minor), 0) AS refunded
     FROM ledger_entries WHERE engagement_id = $1 AND kind = 'refund'
     GROUP BY killbill_payment_id`,
    [engagementId],
  );
  const refundedByPayment = new Map<string, number>();
  for (const refund of refunds.rows) {
    refundedByPayment.set(refund.killbill_payment_id, Number(refund.refunded));
  }
  // oldest first from the DB order above is newest-first already.
  return result.rows.map(row => ({
    ledgerEntryId: row.id as string,
    killbillPaymentId: row.killbill_payment_id as string,
    amountMinor: Number(row.amount_minor),
    invoiceId: row.invoice_id === null ? null : row.invoice_id as string,
    createdAt: new Date(row.created_at),
    refundedMinor: refundedByPayment.get(row.killbill_payment_id) ?? 0,
  }));
}

export function totalConfirmedPayments(payments: ConfirmedPayment[]): number {
  return payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
}

/** Allocation, newest payment first, taking no more than each payment's unredeemed amount. */
export function allocateRefund(payments: ConfirmedPayment[], refundMinor: number): { payment: ConfirmedPayment; amount: number }[] {
  const parts: { payment: ConfirmedPayment; amount: number }[] = [];
  let remaining = refundMinor;
  for (const payment of payments) {
    if (remaining <= 0) {
      break;
    }
    const available = payment.amountMinor - payment.refundedMinor;
    if (available <= 0) {
      continue;
    }
    const take = Math.min(available, remaining);
    parts.push({ payment, amount: take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new ApiError('validation_failed', { refund_minor: 'Enter a refund between 1 and the amount paid.' });
  }
  return parts;
}

export function refundTransactionKey(engagementId: string, paymentId: string): string {
  return `${engagementId}:refund:${paymentId}`;
}

export interface CancelResult {
  engagementId: string;
  ledgerEntryIds: string[];
  refunds: { killbill_payment_id: string; amount_minor: number }[];
  voidedInvoiceIds: string[];
  paidMinor: number;
  refundedMinor: number;
  retainedMinor: number;
}

export async function cancelEngagement(app: App, engagementId: string, requestedRefundMinor: number): Promise<CancelResult> {
  const engagement = await loadEngagementRow(app.pool, engagementId);
  if (engagement === null) {
    throw new ApiError('not_found');
  }
  const { canCancel } = await import('./state');
  if (!canCancel(engagement.state)) {
    throw new ApiError('invalid_state');
  }
  if (!Number.isInteger(requestedRefundMinor) || requestedRefundMinor < 1) {
    throw new ApiError('validation_failed', { refund_minor: 'Enter a refund between 1 and the amount paid.' });
  }

  const payments = await loadConfirmedPayments(app, engagementId);
  const paid = totalConfirmedPayments(payments);
  if (requestedRefundMinor > paid) {
    throw new ApiError('validation_failed', { refund_minor: 'Enter a refund between 1 and the amount paid.' });
  }

  const currency = engagement.brand_currency;
  const exponent = CURRENCIES[currency].exponent;
  const financeEmail = await brandFinanceEmail(app, engagement.brand_id);

  let accountId: string;
  try {
    accountId = await app.killbill.ensureAccount(engagement.brand_id, engagement.brand_name, financeEmail, currency);
  } catch {
    throw new ApiError('billing_unavailable');
  }

  // Count refunds already carrying this cancellation's transaction keys.
  const existingKeyRefunds = await app.pool.query(
    `SELECT killbill_payment_id, COALESCE(SUM(amount_minor), 0) AS refunded
     FROM ledger_entries
     WHERE engagement_id = $1 AND kind = 'refund'
     GROUP BY killbill_payment_id`,
    [engagementId],
  );
  const refundedByPayment = new Map<string, number>();
  for (const row of existingKeyRefunds.rows) {
    refundedByPayment.set(row.killbill_payment_id, Number(row.refunded));
  }

  // Claim the cancellation exclusively: exactly one wins.
  const claim = await app.pool.query(
    `UPDATE engagements SET state = 'cancelled_with_refund'
     WHERE id = $1 AND state = ANY($2) RETURNING id`,
    [engagementId, [engagement.state]],
  );
  if (claim.rows.length === 0) {
    throw new ApiError('invalid_state');
  }

  const recordedRefunds: { killbill_payment_id: string; amount_minor: number }[] = [];
  const ledgerEntryIds: string[] = [];

  // Resumed cancellation: refunds already recorded with our keys count toward the request.
  const alreadyRefundedTotal = [...refundedByPayment.values()].reduce((a, b) => a + b, 0);
  if (alreadyRefundedTotal > requestedRefundMinor) {
    await app.pool.query(
      `UPDATE engagements SET state = $2 WHERE id = $1`,
      [engagementId, engagement.state],
    );
    throw new ApiError('validation_failed', { refund_minor: 'Enter a refund between 1 and the amount paid.' });
  }

  const target = requestedRefundMinor - alreadyRefundedTotal;
  try {
    if (target > 0) {
      const parts = allocateRefund(payments, target);
      for (const part of parts) {
        const transactionKey = refundTransactionKey(engagementId, part.payment.killbillPaymentId);
        await app.killbill.refund(part.payment.killbillPaymentId, currency, exponent, part.amount, transactionKey);
        const entryId = newId();
        await app.pool.query(
          `INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id)
           VALUES ($1, $2, 'refund', $3, $4, $5, $6)`,
          [entryId, engagementId, part.amount, currency, part.payment.invoiceId, part.payment.killbillPaymentId],
        );
        ledgerEntryIds.push(entryId);
        recordedRefunds.push({ killbill_payment_id: part.payment.killbillPaymentId, amount_minor: part.amount });
      }
    }
    // Re-read the ledger so pre-existing refunds from an interrupted attempt are included.
    const allRefundEntries = await app.pool.query(
      `SELECT id, killbill_payment_id, amount_minor FROM ledger_entries
       WHERE engagement_id = $1 AND kind = 'refund' ORDER BY created_at ASC, id ASC`,
      [engagementId],
    );
    const allRefunds = allRefundEntries.rows.map(row => ({
      killbill_payment_id: row.killbill_payment_id as string,
      amount_minor: Number(row.amount_minor),
    }));
    const allLedgerIds = allRefundEntries.rows.map(row => row.id as string);

    // Voids: every unpaid issued/payment_failed/overdue invoice in Kill Bill; drafts become void without Kill Bill.
    const voidable = await app.pool.query(
      `SELECT * FROM invoices
       WHERE engagement_id = $1 AND status IN ('issued','payment_failed','overdue')
       ORDER BY milestone ASC`,
      [engagementId],
    );
    const voidedInvoiceIds: string[] = [];
    for (const invoice of voidable.rows) {
      if (invoice.killbill_invoice_id) {
        await app.killbill.voidInvoice(invoice.killbill_invoice_id);
      }
      await app.pool.query(`UPDATE invoices SET status = 'void', balance_minor = 0 WHERE id = $1`, [invoice.id]);
      voidedInvoiceIds.push(invoice.id as string);
    }
    const draftVoidable = await app.pool.query(
      `SELECT * FROM invoices WHERE engagement_id = $1 AND status = 'draft'`,
      [engagementId],
    );
    for (const invoice of draftVoidable.rows) {
      await app.pool.query(`UPDATE invoices SET status = 'void' WHERE id = $1`, [invoice.id]);
      voidedInvoiceIds.push(invoice.id as string);
    }

    // Kill the review link and clear the overdue block if no overdue invoice remains.
    await app.pool.query(`UPDATE review_links SET active = FALSE WHERE engagement_id = $1`, [engagementId]);
    const remainingOverdue = await app.pool.query(
      `SELECT COUNT(*) AS count FROM invoices i JOIN engagements e ON e.id = i.engagement_id
       WHERE e.brand_id = $1 AND i.status = 'overdue'`,
      [engagement.brand_id],
    );
    if (Number(remainingOverdue.rows[0].count) === 0) {
      try {
        await app.killbill.setBlockingState(accountId, 'CLEAR');
      } catch {
        // clearing can be retried later
      }
    }

    const refundedTotal = allRefunds.reduce((sum, refund) => sum + refund.amount_minor, 0);
    const retained = paid - refundedTotal;

    // One refund email listing every part.
    await app.pool.query(
      `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
      [newId(), JSON.stringify({
        type: 'refund',
        engagement_id: engagementId,
        total_refunded_minor: refundedTotal,
        parts: allRefunds,
      })],
    );

    return {
      engagementId,
      ledgerEntryIds: allLedgerIds,
      refunds: allRefunds,
      voidedInvoiceIds,
      paidMinor: paid,
      refundedMinor: refundedTotal,
      retainedMinor: retained,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // restore state so the founder can retry with a valid amount
      await app.pool.query(
        `UPDATE engagements SET state = $2 WHERE id = $1 AND state = 'cancelled_with_refund'`,
        [engagementId, engagement.state],
      );
      throw error;
    }
    throw new ApiError('billing_unavailable');
  }
}
