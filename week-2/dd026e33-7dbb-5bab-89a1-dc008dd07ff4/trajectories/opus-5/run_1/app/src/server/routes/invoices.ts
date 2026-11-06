import { randomUUID } from 'node:crypto';
import { parseMoney } from '../../shared/money';
import { withTransaction } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import type { Route } from '../http/pipeline';
import {
  buildInvoice,
  buildInvoiceList,
  isZero,
  loadInvoiceRow,
  loadInvoiceRows,
} from '../domain/invoices';
import {
  BillingUnavailable,
  externalPayment,
  readInvoice,
  setPaymentCustomField,
  transferKey,
} from '../providers/killbill';
import { ownerScope } from './cars';

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const invoiceRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/invoices',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('workshop_lead', 'house_manager', 'owner');
      const rows = await loadInvoiceRows(ownerScope(ctx));
      const list = await buildInvoiceList(rows);
      return {
        kind: 'json',
        status: 200,
        body: { invoices: list.invoices, unpaid_total: list.unpaidTotal },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/invoices/:id',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const row = await loadInvoiceRow(ctx.params.id ?? '', ownerScope(ctx));
      if (row === null) throw fail.notFound();
      ctx.requireRole('workshop_lead', 'house_manager', 'owner');
      const built = await buildInvoice(row);
      return { kind: 'json', status: 200, body: { invoice: built.invoice } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/invoices/:id/payments',
    body: 'json',
    session: 'required',
    idempotent: true,
    async handle(ctx) {
      const invoiceId = ctx.params.id ?? '';
      const row = await loadInvoiceRow(invoiceId, ownerScope(ctx));
      if (row === null) throw fail.notFound();
      ctx.requireRole('house_manager');

      await withTransaction(async (tx) => {
        // Transfers on one invoice run one at a time, each checked against the
        // balance Kill Bill reports after the previous one.
        await tx.lock(`invoice:${invoiceId}`);
        let balance = row.last_balance;
        let live = true;
        try {
          balance = (await readInvoice(row.killbill_invoice_id)).balance;
        } catch (error) {
          if (!(error instanceof BillingUnavailable)) throw error;
          live = false;
        }
        if (isZero(balance)) throw fail.conflict('already_paid');

        const errors: FieldErrors = {};
        if (ctx.idempotencyKey === null) {
          errors.idempotency_key = VALIDATION_MESSAGES.idempotencyKey;
        }
        const reference = textOf(ctx.body.reference);
        if (reference.length < 1 || reference.length > 60) {
          errors.reference = VALIDATION_MESSAGES.reference;
        }
        const amount = parseMoney(textOf(ctx.body.amount));
        const limit = parseMoney(balance) ?? 0n;
        if (amount === null || amount < 1n || amount > limit) {
          errors.amount = VALIDATION_MESSAGES.amount(balance);
        }
        if (Object.keys(errors).length > 0) throw fail.validation(errors);
        if (!live) throw fail.billingUnavailable();

        const transferId = randomUUID();
        const paymentId = await externalPayment(
          row.killbill_account_id,
          row.killbill_invoice_id,
          textOf(ctx.body.amount),
          transferKey(transferId),
        );
        await setPaymentCustomField(paymentId, 'bank_reference', reference);
        await tx.query(
          `insert into transfers (id, invoice_id, reference, amount, recorded_by, at, killbill_payment_id)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            transferId,
            invoiceId,
            reference,
            textOf(ctx.body.amount),
            ctx.user().id,
            ctx.now,
            paymentId,
          ],
        );
      });

      const after = await loadInvoiceRow(invoiceId, null);
      if (after === null) throw fail.notFound();
      const built = await buildInvoice(after);
      return { kind: 'json', status: 200, body: { invoice: built.invoice } };
    },
  },
];
