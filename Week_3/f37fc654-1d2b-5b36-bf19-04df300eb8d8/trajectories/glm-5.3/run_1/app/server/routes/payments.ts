import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import * as dates from '../domain/dates.js';
import { KillBill, KillBillUnavailable } from '../services/killbill.js';
import { enqueueJob } from '../jobs.js';
import { publishPayment } from './events.js';

export function paymentsRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);
  const kb = new KillBill(cfg);

  // ---------- Sign ----------

  router.post('/commissions/:id/sign', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { signatureName?: string; acceptTerms?: boolean };
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
        await svc.expireHolds(tx, commission);
        const fresh = (await svc.getCommission(tx, id))!;
        const hold = await svc.latestHold(tx, id);
        const holdStatus = hold ? await svc.holdStatus(tx, hold) : null;
        // A hold that has ended answers hold_expired, whatever the commission state.
        if (hold && holdStatus === 'expired') throw new HttpError(409, 'hold_expired', '');
        if (fresh.state !== 'held') throw new HttpError(409, 'illegal_state', '');
        if (holdStatus !== 'held') throw new HttpError(409, 'hold_expired', '');
        const quote = await svc.currentQuote(tx, id);
        if (!quote) throw new HttpError(409, 'quote_expired', 'This quote has expired. Refresh the quote to continue.');
        if (Date.now() >= quote.valid_until.getTime() + 1000) {
          throw new HttpError(409, 'quote_expired', 'This quote has expired. Refresh the quote to continue.');
        }
        const errors: Record<string, string> = {};
        const name = typeof body.signatureName === 'string' ? body.signatureName.trim() : '';
        if (name.length < 2 || name.length > 80) errors['signatureName'] = 'Type your full name, 2 to 80 characters.';
        if (body.acceptTerms !== true) errors['acceptTerms'] = 'Tick the box to agree.';
        if (Object.keys(errors).length > 0) throw new HttpError(422, 'validation', '', { errors });
        // Existing signing keeps the unpaid deposit invoice when amounts are unchanged.
        const existing = (await tx.query(`SELECT * FROM contract_signings WHERE commission_id = $1 ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0] as
          | { id: string; quote_id: string; version: number; document_id: string | null; deposit_milestone_id: string }
          | undefined;
        if (existing && existing.quote_id === quote.id) {
          return { contractDocumentId: existing.document_id ?? '', contractVersion: existing.version, depositMilestoneId: existing.deposit_milestone_id, reused: true };
        }
        // Invoice the deposit in Kill Bill.
        const milestones = await svc.getMilestones(tx, id);
        const deposit = milestones.find((m) => m.label === 'Deposit');
        if (!deposit) throw new HttpError(404, 'not_found', '');
        const clientRes = await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [fresh.client_id]);
        const client = clientRes.rows[0] as { name: string; email: string };
        const accountId = await kb.ensureAccount(fresh.client_id, client.name, client.email);
        const venue = svc.venueById(fresh.venue_id);
        const invoice = await kb.createInvoice(accountId, fresh.title, 'Deposit', deposit.subtotal_cents, deposit.tax_cents, dates.localDate(new Date(), venue.time_zone));
        const now = new Date();
        const dueAt = dates.milestoneDueAt(now, venue.time_zone);
        const version = (existing?.version ?? 0) + 1;
        const documentId = crypto.randomUUID();
        const signingId = crypto.randomUUID();
        if (deposit.state === 'scheduled') {
          await tx.query(`UPDATE milestones SET state = 'invoiced', invoiced_at = $2, due_at = $3, killbill_invoice_id = $4, quote_id = $5 WHERE id = $1`, [
            deposit.id, now, dueAt, invoice.invoiceId, quote.id,
          ]);
        }
        await tx.query(
          `INSERT INTO documents (id, commission_id, kind, version, label, s3_key, issued_at, killbill_invoice_id)
           VALUES ($1, $2, 'invoice', 1, 'Deposit', $3, $4, $5)`,
          [crypto.randomUUID(), id, `commissions/${id}/documents/invoice-${invoice.invoiceId}.pdf`, now, invoice.invoiceId],
        );
        const depositInvoiceDocId = (await tx.query(`SELECT id FROM documents WHERE commission_id = $1 AND killbill_invoice_id = $2 AND kind = 'invoice'`, [id, invoice.invoiceId])).rows[0] as { id: string };
        await tx.query(`UPDATE milestones SET document_id = $2 WHERE id = $1`, [deposit.id, depositInvoiceDocId.id]);
        await enqueueJob(tx, 'pdf', id, { documentId: depositInvoiceDocId.id, kind: 'invoice' }, `pdf-${depositInvoiceDocId.id}`);
        await tx.query(
          `INSERT INTO documents (id, commission_id, kind, version, label, s3_key, killbill_invoice_id)
           VALUES ($1, $2, 'contract', $3, $4, $5, $6)`,
          [documentId, id, version, 'Commission agreement', `commissions/${id}/documents/contract-v${version}.pdf`, invoice.invoiceId],
        );
        await tx.query(
          `INSERT INTO contract_signings (id, commission_id, quote_id, signature_name, signed_at, version, document_id, deposit_milestone_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [signingId, id, quote.id, name, now, version, documentId, deposit.id],
        );
        // Contract PDF job + deposit-due email + CRM event.
        await enqueueJob(tx, 'pdf', id, { documentId, kind: 'contract' }, `pdf-${documentId}`);
        await enqueueJob(tx, 'email', id, { emailKind: 'milestone_due', milestoneId: deposit.id }, `milestone-due-${deposit.id}`);
        await enqueueJob(tx, 'webhook', id, { eventKind: 'contract.signed', signingId }, `contract-signed-${signingId}`);
        return { contractDocumentId: documentId, contractVersion: version, depositMilestoneId: deposit.id, reused: false };
      });
      res.status(201).json({
        contractDocumentId: result.contractDocumentId,
        contractVersion: result.contractVersion,
        depositMilestoneId: result.depositMilestoneId,
      });
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  // ---------- Idempotent payments ----------

  const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{1,64}$/;

  router.post('/milestones/:milestoneId/payments', auth, async (req, res, next) => {
    try {
      await handlePayment(req, res, 'milestone');
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  router.post('/funders/:funderId/payments', auth, async (req, res, next) => {
    try {
      await handlePayment(req, res, 'funder');
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  async function handlePayment(req: import('express').Request, res: import('express').Response, kind: 'milestone' | 'funder'): Promise<void> {
    const maybeUser = (req as AuthedRequest).user;
    if (!maybeUser) throw new HttpError(401, 'unauthenticated', '');
    const user = maybeUser;
    const targetId = kind === 'milestone' ? (req.params as { milestoneId?: string })['milestoneId'] ?? '' : (req.params as { funderId?: string })['funderId'] ?? '';
    const key = req.headers['idempotency-key'];
    const rawKey = typeof key === 'string' ? key : undefined;
    const body = req.body as { nameOnCard?: string; cardNumber?: string };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const path = req.path;

    const errors: Record<string, string> = {};
    if (!rawKey || !IDEMPOTENCY_RE.test(rawKey)) errors['idempotencyKey'] = 'Send an Idempotency-Key of 1 to 64 letters, digits, - or _.';
    const nameOnCard = typeof body.nameOnCard === 'string' ? body.nameOnCard.trim() : '';
    if (nameOnCard.length < 1 || nameOnCard.length > 80) errors['nameOnCard'] = 'Enter the name on the card.';
    const cardDigits = typeof body.cardNumber === 'string' ? body.cardNumber.replace(/[\s-]/g, '') : '';
    if (!/^\d{13,19}$/.test(cardDigits) || !luhn(cardDigits)) errors['cardNumber'] = 'Check the card number.';
    if (Object.keys(errors).length > 0) {
      res.status(422).json({ errors });
      return;
    }
    const idempotencyKey: string = rawKey!;

    // Idempotency: replays and concurrent duplicates return the original response.
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const existing = (await tx.query(
        `SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2 FOR UPDATE`,
        [user.id, idempotencyKey],
      )).rows[0] as { path: string; request_hash: string; status: number; body: unknown; state: string } | undefined;
      if (existing) {
        if (existing.path !== path || existing.request_hash !== requestHash) {
          await tx.query('ROLLBACK');
          res.status(409).json({ error: { code: 'idempotency_conflict' } });
          return;
        }
        if (existing.state === 'done') {
          await tx.query('ROLLBACK');
          res.status(existing.status).json(existing.body);
          return;
        }
        // In flight: wait up to 10 seconds for the first request.
        const start = Date.now();
        await tx.query('ROLLBACK');
        while (Date.now() - start < 10_000) {
          await new Promise((r) => setTimeout(r, 200));
          const check = (await pool.query(`SELECT status, body, state FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [user.id, idempotencyKey])).rows[0] as { status: number; body: unknown; state: string } | undefined;
          if (check?.state === 'done') {
            res.status(check.status).json(check.body);
            return;
          }
        }
        throw new HttpError(503, 'billing_unavailable', "Payments are paused — our billing system isn't answering. Nothing has been charged.");
      }
      await tx.query(
        `INSERT INTO idempotency_keys (key, user_id, path, request_hash, status, state) VALUES ($1, $2, $3, $4, 200, 'in_flight')`,
        [idempotencyKey, user.id, path, requestHash],
      );
      await tx.query('COMMIT');
    } finally {
      tx.release();
    }

    // A retry with the same key after an unclear outcome first asks Kill Bill.
    const priorPayment = await kb.findPaymentByTransactionKey(idempotencyKey).catch(() => null);
    if (priorPayment) {
      await recordIdempotent(user.id, idempotencyKey, 201, {
        paymentId: priorPayment.paymentId, amountCents: Math.round(priorPayment.amount), subtotalCents: 0, taxCents: 0,
        status: 'paid', killbillInvoiceId: null, killbillPaymentId: priorPayment.paymentId, paidAt: new Date().toISOString(),
      });
      res.status(201).json({
        paymentId: priorPayment.paymentId, amountCents: Math.round(priorPayment.amount), subtotalCents: 0, taxCents: 0,
        status: 'paid', killbillInvoiceId: null, killbillPaymentId: priorPayment.paymentId, paidAt: new Date().toISOString(),
      });
      return;
    }

    try {
      const outcome = await withTransaction(async (tx) => {
        if (kind === 'milestone') {
          const milestone = (await tx.query(`SELECT * FROM milestones WHERE id = $1`, [targetId])).rows[0] as svc.MilestoneRow | undefined;
          if (!milestone) throw new HttpError(404, 'not_found', '');
          const commission = await svc.getCommission(tx, milestone.commission_id);
          if (!commission || (user.role !== 'producer' && commission.client_id !== user.id)) throw new HttpError(404, 'not_found', '');
          await svc.expireHolds(tx, commission);
          const fresh = (await svc.getCommission(tx, commission.id))!;
          if (fresh.state === 'cancelled') throw new HttpError(409, 'commission_cancelled', '');
          if (milestone.state === 'paid') throw new HttpError(409, 'already_paid', '');
          if (milestone.state !== 'invoiced' && milestone.state !== 'failed' && milestone.state !== 'retried') {
            throw new HttpError(409, 'illegal_state', '');
          }
          if (milestone.label === 'Deposit') {
            const hold = await svc.latestHold(tx, commission.id);
            const status = hold ? await svc.holdStatus(tx, hold) : null;
            if (!hold || status !== 'held') throw new HttpError(409, 'hold_expired', '');
            const quote = await svc.currentQuote(tx, commission.id);
            if (!quote || Date.now() >= quote.valid_until.getTime() + 1000) {
              throw new HttpError(409, 'quote_expired', '');
            }
          }
          // Pay the invoice's balance in Kill Bill.
          const clientRes = await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [fresh.client_id]);
          const client = clientRes.rows[0] as { name: string; email: string };
          const accountId = await kb.ensureAccount(fresh.client_id, client.name, client.email);
          const invoiceId = milestone.killbill_invoice_id;
          if (!invoiceId) throw new HttpError(409, 'illegal_state', '');
          const payment = await kb.payInvoice(accountId, invoiceId, milestone.amount_cents, idempotencyKey, `pay-${idempotencyKey}`);
          // Kill Bill confirmed: one transaction records everything together.
          const venue = svc.venueById(fresh.venue_id);
          const paidAt = new Date();
          await tx.query(`UPDATE milestones SET state = 'paid', killbill_payment_id = $2 WHERE id = $1`, [milestone.id, payment.paymentId]);
          await tx.query(`UPDATE idempotency_keys SET state = 'done', status = 201, body = $3 WHERE user_id = $1 AND key = $2`, [
            user.id, idempotencyKey, JSON.stringify({
              paymentId: payment.paymentId, amountCents: milestone.amount_cents, subtotalCents: milestone.subtotal_cents, taxCents: milestone.tax_cents,
              status: 'paid', killbillInvoiceId: milestone.killbill_invoice_id, killbillPaymentId: payment.paymentId, paidAt: paidAt.toISOString(),
            }),
          ]);
          await recordPaymentEffects(tx, {
            commissionId: commission.id,
            commissionTitle: fresh.title,
            payerName: user.name,
            label: milestone.label,
            amountCents: milestone.amount_cents,
            killbillPaymentId: payment.paymentId,
            milestoneId: milestone.id,
            killbillInvoiceId: milestone.killbill_invoice_id,
            venueTimeZone: venue.time_zone,
          });
          // Deposit confirmation books the install day and moves to contracted.
          if (milestone.label === 'Deposit') {
            const hold = await svc.latestHold(tx, commission.id);
            if (hold && (await svc.holdStatus(tx, hold)) === 'held') {
              const start = dates.startOfLocalDay(hold.date, venue.time_zone);
              const end = dates.startOfLocalDay(dates.addDays(hold.date, 1), venue.time_zone);
              await tx.query(
                `INSERT INTO install_days (id, venue_id, commission_id, date, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (venue_id, date) DO NOTHING`,
                [crypto.randomUUID(), hold.venue_id, commission.id, hold.date, start, end],
              );
              await tx.query(`UPDATE holds SET state = 'booked' WHERE id = $1`, [hold.id]);
              await svc.setState(tx, commission.id, 'contracted');
              await enqueueJob(tx, 'crew_alert', commission.id, { alertKind: 'slot_confirmed' }, `slot-confirmed-${hold.id}`);
              await enqueueJob(tx, 'crew_alert', commission.id, { alertKind: 'day_before_loadin' }, `loadin-${hold.id}`);
            }
          }
          return {
            paymentId: payment.paymentId, amountCents: milestone.amount_cents, subtotalCents: milestone.subtotal_cents, taxCents: milestone.tax_cents,
            status: 'paid', killbillInvoiceId: milestone.killbill_invoice_id, killbillPaymentId: payment.paymentId, paidAt: paidAt.toISOString(),
          };
        } else {
          const funder = (await tx.query(`SELECT * FROM funders WHERE id = $1`, [targetId])).rows[0] as svc.FunderRow | undefined;
          if (!funder) throw new HttpError(404, 'not_found', '');
          if (funder.state === 'paid') throw new HttpError(409, 'already_paid', '');
          if (funder.state !== 'invoiced' && funder.state !== 'failed') throw new HttpError(409, 'illegal_state', '');
          const commission = await svc.getCommission(tx, funder.commission_id);
          if (!commission) throw new HttpError(404, 'not_found', '');
          if (commission.state === 'cancelled') throw new HttpError(409, 'commission_cancelled', '');
          if (!funder.app_user_id || funder.app_user_id !== user.id) throw new HttpError(404, 'not_found', '');
          const accountId = await kb.ensureAccount(funder.app_user_id, funder.name ?? user.name, funder.email ?? user.email);
          const invoiceId = funder.killbill_invoice_id;
          if (!invoiceId) throw new HttpError(409, 'illegal_state', '');
          const payment = await kb.payInvoice(accountId, invoiceId, funder.amount_cents ?? 0, idempotencyKey, `pay-${idempotencyKey}`);
          const paidAt = new Date();
          await tx.query(`UPDATE funders SET state = 'paid', killbill_payment_id = $2 WHERE id = $1`, [funder.id, payment.paymentId]);
          await tx.query(`UPDATE idempotency_keys SET state = 'done', status = 201, body = $3 WHERE user_id = $1 AND key = $2`, [
            user.id, idempotencyKey, JSON.stringify({
              paymentId: payment.paymentId, amountCents: funder.amount_cents, subtotalCents: funder.subtotal_cents, taxCents: funder.tax_cents,
              status: 'paid', killbillInvoiceId: funder.killbill_invoice_id, killbillPaymentId: payment.paymentId, paidAt: paidAt.toISOString(),
            }),
          ]);
          const venue = svc.venueById(commission.venue_id);
          await recordPaymentEffects(tx, {
            commissionId: commission.id,
            commissionTitle: commission.title,
            payerName: funder.name ?? user.name,
            label: 'Sponsor share',
            amountCents: funder.amount_cents ?? 0,
            killbillPaymentId: payment.paymentId,
            milestoneId: null,
            killbillInvoiceId: funder.killbill_invoice_id,
            venueTimeZone: venue.time_zone,
          });
          return {
            paymentId: payment.paymentId, amountCents: funder.amount_cents, subtotalCents: funder.subtotal_cents, taxCents: funder.tax_cents,
            status: 'paid', killbillInvoiceId: funder.killbill_invoice_id, killbillPaymentId: payment.paymentId, paidAt: paidAt.toISOString(),
          };
        }
      });
      res.status(201).json(outcome);
    } catch (e) {
      if (e instanceof KillBillUnavailable || (e instanceof Error && e.message.includes('killbill'))) {
        await markAttemptFailed(user.id, idempotencyKey);
        throw new KillBillUnavailable('killbill down');
      }
      if (e instanceof HttpError && (e.status === 409 || e.status === 404 || e.status === 422)) {
        // Conflict answers fail the attempt too, but the stored body is the error itself.
        await pool.query(`UPDATE idempotency_keys SET state = 'done', status = $3, body = $4 WHERE user_id = $1 AND key = $2`, [
          user.id, idempotencyKey, e.status, JSON.stringify({ error: { code: e.code, message: e.message, ...e.extra } }),
        ]);
        throw e;
      }
      await markAttemptFailed(user.id, idempotencyKey);
      throw e;
    }
  }

  async function recordIdempotent(userId: string, key: string, status: number, body: unknown): Promise<void> {
    await pool.query(`UPDATE idempotency_keys SET state = 'done', status = $3, body = $4 WHERE user_id = $1 AND key = $2`, [userId, key, status, JSON.stringify(body)]);
  }

  async function markAttemptFailed(userId: string, key: string): Promise<void> {
    await pool.query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND state = 'in_flight'`, [userId, key]);
  }

  /** Records the shared effects of a confirmed payment, in the caller's transaction. */
  async function recordPaymentEffects(
    tx: svc.DbClientAlias,
    effect: {
      commissionId: string;
      payerName: string;
      label: string;
      amountCents: number;
      killbillPaymentId: string;
      milestoneId: string | null;
      killbillInvoiceId: string | null;
      venueTimeZone: string;
      commissionTitle: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ledger_entries (id, commission_id, payer_name, label, amount_cents, killbill_payment_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), effect.commissionId, effect.payerName, effect.label, effect.amountCents, effect.killbillPaymentId],
    );
    await tx.query(
      `INSERT INTO board_events (id, commission_id, payer_name, amount_cents, label) VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), effect.commissionId, effect.payerName, effect.amountCents, effect.label],
    );
    publishPayment(effect.commissionId, effect.payerName, effect.amountCents, effect.label, effect.commissionTitle);
    await enqueueJob(tx, 'email', effect.commissionId, { emailKind: 'receipt', payerName: effect.payerName, label: effect.label, amountCents: effect.amountCents, killbillPaymentId: effect.killbillPaymentId, killbillInvoiceId: effect.killbillInvoiceId }, `receipt-${effect.killbillPaymentId}`);
    if (effect.milestoneId) {
      await enqueueJob(tx, 'email', effect.commissionId, { emailKind: 'milestone_paid', milestoneId: effect.milestoneId, killbillPaymentId: effect.killbillPaymentId }, `milestone-paid-${effect.milestoneId}`);
      await enqueueJob(tx, 'webhook', effect.commissionId, { eventKind: 'milestone.paid', milestoneId: effect.milestoneId, killbillPaymentId: effect.killbillPaymentId }, `crm-${effect.milestoneId}`);
    }
  }

  function luhn(digits: string): boolean {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = Number(digits[i]);
      if (d > 9) return false;
      if (alt) {
        const dd = d * 2;
        sum += dd > 9 ? dd - 9 : dd;
      } else {
        sum += d;
      }
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  return router;
}
