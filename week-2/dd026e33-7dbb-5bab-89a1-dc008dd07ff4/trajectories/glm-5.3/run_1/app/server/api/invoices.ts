import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, trimmed, Validator, money2dp } from '../validation.ts';
import { requireRole, WORKSHOP } from './guards.ts';
import { lockKey, type Tx } from '../db.ts';
import { loadInvoice, projectInvoice, refreshInvoice, type InvoiceRow } from './jobs.ts';
import { withIdempotency, requireIdempotencyKey } from '../idemwrap.ts';
import { isBillingDown } from '../providers/status.ts';
import { KillBillError } from '../providers/killbill.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

async function visibleInvoice(rc: RouteContext, tx: Tx | null, invoiceId: string): Promise<InvoiceRow> {
  const invoice = await loadInvoice(rc, tx, invoiceId);
  if (rc.viewer.isOwner() && invoice.owner_id !== rc.viewer.id) {
    throw ERRORS.notFound();
  }
  return invoice;
}

export const invoiceRoutes: Route[] = [
  route('GET', '/api/invoices', {}, async (rc) => {
    const rows = await rc.ctx.db.query<InvoiceRow>(
      rc.viewer.isOwner()
        ? `SELECT i.id, i.number, i.job_id, j.car_id,
             concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
             c.owner_id, u.name AS owner_name, u.email AS owner_email,
             i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
             i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
           FROM invoices i
           JOIN jobs j ON j.id = i.job_id
           JOIN cars c ON c.id = j.car_id
           JOIN users u ON u.id = c.owner_id
           WHERE c.owner_id = $1 ORDER BY i.issued_at DESC`
        : `SELECT i.id, i.number, i.job_id, j.car_id,
             concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
             c.owner_id, u.name AS owner_name, u.email AS owner_email,
             i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
             i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
           FROM invoices i
           JOIN jobs j ON j.id = i.job_id
           JOIN cars c ON c.id = j.car_id
           JOIN users u ON u.id = c.owner_id
           ORDER BY i.issued_at DESC`,
      rc.viewer.isOwner() ? [rc.viewer.id] : [],
    );
    if (!rc.viewer.isOwner()) {
      requireRole(rc.viewer, [...WORKSHOP]);
    }
    // refresh each balance from Kill Bill; failures fall back to the last confirmed
    const refreshed: InvoiceRow[] = [];
    for (const invoice of rows) {
      await refreshInvoice(rc, null, invoice);
      refreshed.push(invoice);
    }
    const withBalance = refreshed.filter((invoice) => Number(invoice.balance) > 0);
    const unpaidTotal = withBalance.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
    const invoices = [];
    for (const invoice of refreshed) {
      invoices.push(await projectInvoice(rc, invoice));
    }
    return {
      status: 200,
      body: {
        invoices,
        unpaid_total: unpaidTotal.toFixed(2),
      },
    };
  }),

  route('GET', '/api/invoices/{id}', {}, async (rc) => {
    const invoice = await visibleInvoice(rc, null, rc.params['id'] as string);
    if (!rc.viewer.isOwner()) {
      requireRole(rc.viewer, [...WORKSHOP]);
    }
    await refreshInvoice(rc, null, invoice);
    return { status: 200, body: { invoice: await projectInvoice(rc, invoice) } };
  }),

  route('POST', '/api/invoices/{id}/payments', {}, async (rc) => {
    return withIdempotency(rc, 'POST:/api/invoices/{id}/payments', async (tx) => {
      const invoice = await visibleInvoice(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, ['house_manager']);
      await lockKey(tx, 'invoice', invoice.id);

      const record = bodyOf(rc);
      const v = new Validator();
      const reference = trimmed(record['reference']);
      v.check(reference.length >= 1 && reference.length <= 60, 'reference', 'Enter 1 to 60 characters.');
      const amountRaw = str(record['amount']).trim();
      const amount = money2dp(record['amount']);

      // Live balance from Kill Bill; the last confirmed balance stands in when
      // Kill Bill does not answer.
      await refreshInvoice(rc, tx, invoice);
      const live = invoice.balance_live;
      const balance = invoice.balance;
      if (live && Number(balance) === 0) {
        throw ERRORS.conflict('already_paid');
      }
      if (!v.check(amount !== null && Number(amount) >= 0.01 && Number(amount) <= Number(balance), 'amount', `Enter an amount from 0.01 to ${balance}.`)) {
        // fall through to throwIfInvalid below
      }
      v.throwIfInvalid();
      if (!live) {
        // passed the last-confirmed check; Kill Bill must take the payment
        throw ERRORS.billingUnavailable();
      }

      requireIdempotencyKey(rc);
      const transferId = `t-${crypto.randomUUID().slice(0, 12)}`;
      let payment: { paymentId: string; amount: string; refundedAmount: string; effectiveDate: string };
      try {
        payment = await rc.ctx.killbill.createExternalPayment(
          await rc.ctx.killbill.ensureAccount(
            `${rc.ctx.env.killbill.keyPrefix}owner-${invoice.owner_id}`,
            invoice.owner_name,
            invoice.owner_email,
          ),
          invoice.killbill_invoice_id as string,
          amount as string,
          reference,
        );
      } catch (err) {
        if (err instanceof KillBillError && err.isUnavailable) {
          throw ERRORS.billingUnavailable();
        }
        throw err;
      }

      await tx.query(
        `INSERT INTO transfers (id, invoice_id, reference, amount, at, recorded_by_user_id, killbill_payment_id)
         VALUES ($1,$2,$3,$4,now(),$5,$6)`,
        [transferId, invoice.id, reference, amount, rc.viewer.id, payment.paymentId],
      );
      await tx.query(
        `INSERT INTO payments (payment_id, invoice_id, amount, refunded, effective_date, transfer_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (payment_id) DO UPDATE SET amount = $3, refunded = $4, transfer_id = $6`,
        [payment.paymentId, invoice.id, amount, '0.00', payment.effectiveDate, transferId],
      );
      // read the balance back from Kill Bill; a provider failure keeps the
      // last confirmed values and reports the invoice as not live
      let newBalance = balance;
      try {
        const kbInvoice = await rc.ctx.killbill.getInvoice(invoice.killbill_invoice_id as string);
        newBalance = kbInvoice.balance;
      } catch (err) {
        if (err instanceof KillBillError) {
          throw ERRORS.billingUnavailable();
        }
        throw err;
      }
      await tx.query(
        `UPDATE invoices SET balance = $2, balance_live = TRUE,
          paid_at = CASE WHEN $2 = '0.00' THEN $3::timestamptz ELSE NULL END,
          status_confirmed_at = now()
         WHERE id = $1`,
        [invoice.id, newBalance, payment.effectiveDate],
      );
      if (newBalance === '0.00') {
        await tx.query(`UPDATE jobs SET status = 'paid', version = version + 1 WHERE id = $1 AND status = 'invoiced'`, [invoice.job_id]);
      }
      const fresh = await loadInvoice(rc, tx, invoice.id);
      return { status: 200, body: { invoice: await projectInvoice(rc, fresh) } };
    });
  }),
];
