import { Router } from 'express';
import type { Request, Response } from 'express';
import type { App } from '../app';
import { ApiError } from '../errors';
import { loadEngagement, loadEngagementRow, serializeInvoice, serializeLedger, newId } from '../domain';
import { requireClient, type ClientSession } from '../middleware';
import { beginIdempotency, finishIdempotency, releaseIdempotency, idempotencyKey } from '../idempotency';
import { payDeposit, checkCard } from '../billing';
import { refreshOverdue, refreshOverdueForInvoice, clearBlockingState, isPayableStatus } from '../invoices';
import type { TestCard } from '../types';
import type { EngagementRow } from '../domain';

function sessionOf(req: Request): ClientSession {
  return (req as unknown as { session: ClientSession }).session;
}

function cardFromBody(body: Record<string, unknown>): TestCard {
  const card = body.card as Record<string, unknown> | undefined;
  return {
    number: typeof card?.number === 'string' ? card.number : '',
    expiry: typeof card?.expiry === 'string' ? card.expiry : '',
    cvc: typeof card?.cvc === 'string' ? card.cvc : '',
    name: typeof card?.name === 'string' ? card.name : '',
  };
}

function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

export function billingRoutes(app: App): Router {
  const router = Router();
  router.use(['/api/engagements', '/api/engagements/', '/api/invoices', '/api/invoices/'], requireClient(app));

  router.post('/api/engagements/:id/deposit', async (req, res, next) => {
    const session = sessionOf(req);
    const engagementId = param(req, 'id');
    try {
      const row = await loadEngagementRow(app.pool, engagementId);
      if (row === null || row.brand_id !== session.brandId) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const key = idempotencyKey(req);
      if (!key) {
        throw new ApiError('idempotency_key_required');
      }
      const scope = `deposit:${session.brandId}`;
      const bodyText = JSON.stringify(req.body ?? {});
      // Precedence: the idempotency key is decided before any state check.
      const outcome = await beginIdempotency(app, scope, key, bodyText).catch(error => {
        throw error;
      });
      if (outcome.replay) {
        res.status(outcome.storedStatus ?? 201).json(outcome.storedBody ?? {});
        return;
      }
      try {
        const card = cardFromBody(req.body as Record<string, unknown>);
        checkCard(card);
        const result = await payDeposit(app, engagementId, card);
        const engagement = await loadEngagement(app, engagementId);
        const invoiceRow = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [result.invoiceId]);
        const invoice = serializeInvoice({ ...invoiceRow.rows[0], currency: engagement?.brand.currency }, []);
        const lines = await app.pool.query(`SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`, [result.invoiceId]);
        invoice.lines = lines.rows.map(l => ({ description: l.description, amount_minor: Number(l.amount_minor) }));
        const ledgerRow = await app.pool.query(`SELECT * FROM ledger_entries WHERE id = $1`, [result.ledgerEntryId]);
        const ledger = serializeLedger(ledgerRow.rows[0]);
        const body = { engagement, invoice, ledger_entry: ledger };
        await finishIdempotency(app, scope, key, 201, body);
        res.status(201).json(body);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'card_declined') {
            // 402 outcomes are stored so replays don't charge twice.
            await finishIdempotency(app, scope, key, 402, { error: error.code, message: error.message });
          } else if (error.status >= 500) {
            // 503 outcomes are not stored.
            await releaseIdempotency(app, scope, key);
          } else {
            await releaseIdempotency(app, scope, key);
          }
          throw error;
        }
        await releaseIdempotency(app, scope, key);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/invoices/:invoiceId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const invoice = await app.pool.query(
        `SELECT i.*, e.brand_id FROM invoices i JOIN engagements e ON e.id = i.engagement_id WHERE i.id = $1`,
        [param(req, 'invoiceId')],
      );
      if (invoice.rows.length === 0 || invoice.rows[0].brand_id !== session.brandId || invoice.rows[0].issued_at === null) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const engagementRow = await loadEngagementRow(app.pool, invoice.rows[0].engagement_id);
      await refreshOverdueForInvoice(app, engagementRow as EngagementRow, param(req, 'invoiceId'));
      const fresh = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [param(req, 'invoiceId')]);
      const lines = await app.pool.query(`SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`, [param(req, 'invoiceId')]);
      const serialized = serializeInvoice({ ...fresh.rows[0], currency: engagementRow?.brand_currency }, []);
      serialized.lines = lines.rows.map(l => ({ description: l.description, amount_minor: Number(l.amount_minor) }));
      res.json(serialized);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/invoices/:invoiceId/payments', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const invoiceLookup = await app.pool.query(
        `SELECT i.*, e.brand_id FROM invoices i JOIN engagements e ON e.id = i.engagement_id WHERE i.id = $1`,
        [param(req, 'invoiceId')],
      );
      if (invoiceLookup.rows.length === 0 || invoiceLookup.rows[0].brand_id !== session.brandId) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const key = idempotencyKey(req);
      if (!key) {
        throw new ApiError('idempotency_key_required');
      }
      const scope = `payment:${session.brandId}:${param(req, 'invoiceId')}`;
      const bodyText = JSON.stringify(req.body ?? {});
      const outcome = await beginIdempotency(app, scope, key, bodyText);
      if (outcome.replay) {
        res.status(outcome.storedStatus ?? 201).json(outcome.storedBody ?? {});
        return;
      }
      try {
        const invoice = invoiceLookup.rows[0];
        const card = cardFromBody(req.body as Record<string, unknown>);
        const decline = checkCard(card).decline;
        if (decline) {
          await declineInvoicePayment(app, invoice.id);
          const error = new ApiError('card_declined');
          await finishIdempotency(app, scope, key, 402, { error: error.code, message: error.message });
          throw error;
        }
        const result = await payInvoice(app, invoice.id, card);
        const freshInvoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoice.id]);
        const lines = await app.pool.query(`SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`, [invoice.id]);
        const serialized = serializeInvoice(freshInvoice.rows[0], []);
        serialized.lines = lines.rows.map(l => ({ description: l.description, amount_minor: Number(l.amount_minor) }));
        const ledger = serializeLedger((await app.pool.query(`SELECT * FROM ledger_entries WHERE id = $1`, [result.ledgerEntryId])).rows[0]);
        const body = { invoice: serialized, ledger_entry: ledger };
        await finishIdempotency(app, scope, key, 201, body);
        res.status(201).json(body);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'card_declined') {
            await finishIdempotency(app, scope, key, 402, { error: error.code, message: error.message });
          } else if (error.status >= 500) {
            await releaseIdempotency(app, scope, key);
          } else {
            await releaseIdempotency(app, scope, key);
          }
          throw error;
        }
        await releaseIdempotency(app, scope, key);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export async function payInvoice(app: App, invoiceId: string, card: TestCard): Promise<{ ledgerEntryId: string }> {
  const invoiceResult = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  const invoice = invoiceResult.rows[0];
  if (!invoice || !isPayableStatus(invoice.status)) {
    throw new ApiError('invoice_not_payable');
  }
  const engagement = await loadEngagementRow(app.pool, invoice.engagement_id);
  if (engagement === null) {
    throw new ApiError('not_found');
  }
  const currency = engagement.brand_currency;
  const exponent = (await import('../money')).CURRENCIES[currency].exponent;
  const amountMinor = Number(invoice.amount_minor);
  const financeEmail = await (await import('../billing')).brandFinanceEmail(app, engagement.brand_id);

  let accountId: string;
  try {
    accountId = await app.killbill.ensureAccount(engagement.brand_id, engagement.brand_name, financeEmail, currency);
  } catch {
    throw new ApiError('billing_unavailable');
  }

  const paymentExternalKey = `${engagement.id}:invoice:${invoice.id}:${newId()}`;
  let paymentId: string;
  let killbillInvoiceId = invoice.killbill_invoice_id;
  try {
    const purchase = await app.killbill.purchase(
      killbillInvoiceId as string, accountId, currency, exponent, amountMinor, paymentExternalKey,
    );
    paymentId = purchase.paymentId;
  } catch {
    throw new ApiError('billing_unavailable');
  }

  // Paid only when Kill Bill confirms the payment and a zero balance.
  let confirmed = false;
  try {
    const kbInvoice = await app.killbill.getInvoice(killbillInvoiceId as string);
    confirmed = kbInvoice.balance === 0;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    throw new ApiError('billing_unavailable');
  }

  const wasOverdue = invoice.status === 'overdue';
  const ledgerEntryId = newId();
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE invoices SET status = 'paid', balance_minor = 0, overdue_at = NULL
       WHERE id = $1 AND status IN ('issued','payment_failed','overdue') RETURNING *`,
      [invoiceId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError('invoice_not_payable');
    }
    await client.query(
      `INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id)
       VALUES ($1, $2, 'invoice_payment', $3, $4, $5, $6)`,
      [ledgerEntryId, engagement.id, amountMinor, currency, invoiceId, paymentId],
    );
    await client.query(
      `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
      [newId(), JSON.stringify({ type: 'invoice_receipt', engagement_id: engagement.id, invoice_id: invoiceId })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (wasOverdue || invoice.status === 'payment_failed') {
    await clearBlockingState(app, engagement);
  }
  return { ledgerEntryId };
}

/** A declined card on a milestone invoice: payment_failed, notice, still payable. */
export async function declineInvoicePayment(app: App, invoiceId: string): Promise<void> {
  const invoiceResult = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  const invoice = invoiceResult.rows[0];
  if (!invoice || !isPayableStatus(invoice.status)) {
    throw new ApiError('invoice_not_payable');
  }
  const engagement = await loadEngagementRow(app.pool, invoice.engagement_id);
  if (engagement === null) {
    throw new ApiError('not_found');
  }
  const overdueAt = invoice.overdue_at
    ? invoice.overdue_at
    : new Date(Date.now() + app.config.timers.overdueAfterSeconds * 1000).toISOString();
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE invoices SET failed_attempts = failed_attempts + 1, status = 'payment_failed', overdue_at = $2 WHERE id = $1`,
      [invoiceId, overdueAt],
    );
    await client.query(
      `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
      [newId(), JSON.stringify({ type: 'payment_failed', engagement_id: engagement.id, invoice_id: invoiceId })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { refreshOverdue };
export type { EngagementRow };
