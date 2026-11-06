import { Router } from 'express';
import { many, one, pool, withTransaction } from '../db/pool.js';
import { newId, newVoucherCode } from '../lib/codes.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatEuros } from '../lib/money.js';
import { toUtcIso } from '../lib/time.js';
import { withIdempotency } from '../http/idempotency.js';
import { requireRole } from '../http/middleware.js';
import { asInteger, asString, asStringArray, asTrimmed, expectObject, fail } from '../http/validate.js';
import { writeAudit } from '../domain/audit.js';
import { formatDate } from '../domain/format.js';
import {
  firstReturnAt,
  latestCollection,
  loadInvoice,
  nextRetryInstant,
  serialiseInvoice,
} from '../domain/invoices.js';
import { loadOrder, orderLines, serialiseOrder } from '../domain/orders.js';
import { recordPayment } from '../domain/payments.js';
import {
  lineRefundable,
  listRefunds,
  refundOrderLines,
} from '../domain/refunds.js';
import {
  listMismatches,
  loadMismatch,
  loadRun,
  runReconciliation,
  serialiseMismatch,
} from '../domain/reconciliation.js';
import { recordMovement, voucherBalance } from '../domain/vouchers.js';
import * as killbill from '../services/killbill.js';
import { queueMail } from '../services/mail.js';

export const financeRouter = Router();

financeRouter.get('/finance/orders', async (req, res) => {
  requireRole(req, 'finance');
  const query = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
  const rows =
    query.length === 0
      ? await many<{ id: string }>(pool, `SELECT id FROM orders ORDER BY created_at DESC`)
      : await many<{ id: string }>(
          pool,
          `SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
           WHERE o.ref ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
           ORDER BY o.created_at DESC`,
          [query],
        );
  const orders = [];
  for (const row of rows) {
    const order = await loadOrder(pool, row.id);
    if (order !== null) orders.push(await serialiseOrder(pool, order));
  }
  res.status(200).json({ orders });
});

financeRouter.post('/finance/orders/:id/refunds', async (req, res) => {
  const caller = requireRole(req, 'finance');
  const order = await loadOrder(pool, req.params.id);
  if (order === null) throw notFound();

  await withIdempotency(req, res, caller.id, 'finance-refund', async () => {
    const body = expectObject(req.body);
    const lineIds = asStringArray(body['line_ids']) ?? [];
    const reason = asTrimmed(body['reason']);

    const refund = await withTransaction(async (tx) => {
      const lines = await orderLines(tx, order.id);
      const chosen = lines.filter((line) => lineIds.includes(line.id));
      if (chosen.length !== lineIds.length) throw notFound();
      const notRefundable = chosen.filter((line) => !lineRefundable(line));
      if (notRefundable.length > 0) {
        throw conflict('line_not_refundable', {
          line_ids: notRefundable.map((line) => line.id),
        });
      }
      if (lineIds.length === 0) fail('line_ids', 'empty');
      if (reason === null) fail('reason', 'required');
      const created = await refundOrderLines(tx, order, chosen, reason, caller.email);
      await writeAudit(tx, {
        actor: caller.email,
        actorRole: caller.role,
        action: 'refund.created',
        targetType: 'order',
        targetId: order.id,
        detail: { refund_id: created.id, line_ids: lineIds },
      });
      return created;
    });

    return {
      status: 201,
      body: {
        id: refund.id,
        order_id: refund.order_id,
        line_ids: refund.line_ids,
        card_cents: refund.card_cents,
        voucher_cents: refund.voucher_cents,
        credit_note_id: refund.credit_note_id,
        status: refund.status,
        reason: refund.reason,
        created_at: toUtcIso(refund.created_at),
      },
    };
  });
});

financeRouter.get('/finance/refunds', async (req, res) => {
  requireRole(req, 'finance');
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  const rows = await listRefunds(pool, status);
  res.status(200).json({
    refunds: rows.map((row) => ({
      id: row.id,
      order_id: row.order_id,
      line_ids: row.line_ids,
      card_cents: row.card_cents,
      voucher_cents: row.voucher_cents,
      credit_note_id: row.credit_note_id,
      status: row.status,
      reason: row.reason,
      created_at: toUtcIso(row.created_at),
    })),
  });
});

financeRouter.post('/finance/vouchers', async (req, res) => {
  const caller = requireRole(req, 'finance');
  const body = expectObject(req.body);
  const amount = asInteger(body['amount_cents']);
  const note = asString(body['note']) ?? '';
  if (amount === null || amount < 1 || amount > 100_000) fail('amount_cents', 'out_of_range');

  const code = await withTransaction(async (tx) => {
    const generated = newVoucherCode();
    await tx.query(`INSERT INTO vouchers (code, note) VALUES ($1, $2)`, [generated, note]);
    await recordMovement(tx, {
      kind: 'issue',
      code: generated,
      amountCents: amount,
      actor: caller.email,
      orderRef: null,
    });
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'voucher.issued',
      targetType: 'voucher',
      targetId: generated,
      detail: { amount_cents: amount },
    });
    return generated;
  });

  res.status(201).json({ code, balance_cents: await voucherBalance(pool, code) });
});

financeRouter.get('/finance/ledger', async (req, res) => {
  requireRole(req, 'finance');
  const account = typeof req.query['account'] === 'string' ? req.query['account'] : '';
  if (!account.startsWith('voucher:')) fail('account', 'unknown');
  const code = account.slice('voucher:'.length);
  const voucher = await one<{ code: string }>(pool, `SELECT code FROM vouchers WHERE code = $1`, [
    code,
  ]);
  if (voucher === null) fail('account', 'unknown');

  const movements = await many<{
    id: string;
    kind: string;
    amount_cents: number;
    created_at: Date;
    actor: string;
    order_ref: string | null;
  }>(
    pool,
    `SELECT id, kind, amount_cents, created_at, actor, order_ref FROM ledger_movements
     WHERE voucher_code = $1 ORDER BY created_at, id`,
    [code],
  );

  const detailed = [];
  for (const movement of movements) {
    const entries = await many<{ account: string; side: string; amount_cents: number }>(
      pool,
      `SELECT account, side, amount_cents FROM ledger_entries WHERE movement_id = $1
       ORDER BY side DESC`,
      [movement.id],
    );
    detailed.push({
      id: movement.id,
      kind: movement.kind,
      amount_cents: movement.amount_cents,
      created_at: toUtcIso(movement.created_at),
      actor: movement.actor,
      order_ref: movement.order_ref,
      entries,
    });
  }

  res.status(200).json({
    account,
    balance_cents: await voucherBalance(pool, code),
    movements: detailed,
  });
});

financeRouter.post('/finance/invoices/:id/returns', async (req, res) => {
  const caller = requireRole(req, 'finance');
  const body = expectObject(req.body);
  const note = asTrimmed(body['note']);

  const invoice = await withTransaction(async (tx) => {
    const existing = await loadInvoice(tx, req.params.id);
    if (existing === null) throw notFound();
    if (existing.status !== 'paid' && existing.status !== 'retried') {
      throw conflict('not_collected');
    }
    if (note === null) fail('note', 'required');

    const collection = await latestCollection(tx, existing.id);
    if (collection === null) throw conflict('not_collected');

    if (collection.killbill_payment_id !== null) {
      const chargeback = await killbill.chargeback(
        collection.killbill_payment_id,
        collection.amount_cents,
        `${existing.number}-${collection.attempt}-chargeback`,
      );
      await recordPayment(tx, { invoiceId: existing.id, transaction: chargeback });
    }

    await tx.query(
      `INSERT INTO invoice_returns (id, invoice_id, collection_id, amount_cents, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), existing.id, collection.id, collection.amount_cents, note],
    );

    const writtenOff = existing.retries_used >= 3;
    if (writtenOff) {
      if (existing.killbill_invoice_id !== null) {
        await killbill.writeOffInvoice(existing.killbill_invoice_id);
      }
      await tx.query(
        `UPDATE invoices SET status = 'written_off', next_retry_at = NULL WHERE id = $1`,
        [existing.id],
      );
    } else {
      const firstReturn = (await firstReturnAt(tx, existing.id)) ?? new Date();
      await tx.query(`UPDATE invoices SET status = 'payment_failed', next_retry_at = $2 WHERE id = $1`, [
        existing.id,
        nextRetryInstant(firstReturn, existing.retries_used),
      ]);
    }

    const order = await loadOrder(tx, existing.order_id);
    const nextRetry = writtenOff
      ? null
      : nextRetryInstant((await firstReturnAt(tx, existing.id)) ?? new Date(), existing.retries_used);
    if (order !== null) {
      await queueMail(tx, {
        eventKey: `invoice-return:${existing.id}:${collection.attempt}`,
        to: order.buyer_email,
        subject: `Payment returned — invoice ${existing.number}`,
        body: [
          `The bank returned the payment of ${formatEuros(collection.amount_cents)} for invoice ${existing.number}.`,
          '',
          writtenOff
            ? `Invoice ${existing.number} is written off.`
            : `We will try again on ${formatDate(nextRetry as Date)}.`,
        ].join('\n'),
      });
    }

    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'invoice.returned',
      targetType: 'invoice',
      targetId: existing.id,
      detail: { note, written_off: writtenOff },
    });

    const updated = await loadInvoice(tx, existing.id);
    if (updated === null) throw new Error('invoice vanished');
    return updated;
  });

  res.status(200).json(await serialiseInvoice(pool, invoice));
});

financeRouter.post('/finance/reconciliation-runs', async (req, res) => {
  const caller = requireRole(req, 'finance');
  const run = await withTransaction(async (tx) => {
    const result = await runReconciliation(tx);
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'reconciliation.run',
      targetType: 'reconciliation_run',
      targetId: result.id,
      detail: { checked_transactions: result.checked_transactions },
    });
    return result;
  });
  res.status(201).json(run);
});

financeRouter.get('/finance/reconciliation-runs/:id', async (req, res) => {
  requireRole(req, 'finance');
  const run = await loadRun(pool, req.params.id);
  if (run === null) throw notFound();
  res.status(200).json(run);
});

financeRouter.get('/finance/mismatches', async (req, res) => {
  requireRole(req, 'finance');
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  const rows = await listMismatches(pool, status);
  res.status(200).json({ mismatches: rows.map(serialiseMismatch) });
});

financeRouter.post('/finance/mismatches/:id/resolve', async (req, res) => {
  const caller = requireRole(req, 'finance');
  const body = expectObject(req.body);
  const note = asTrimmed(body['note']);

  const mismatch = await withTransaction(async (tx) => {
    const existing = await loadMismatch(tx, req.params.id);
    if (existing === null) throw notFound();
    if (existing.status === 'resolved') throw conflict('already_resolved');
    if (note === null) fail('note', 'required');
    await tx.query(
      `UPDATE mismatches SET status = 'resolved', note = $2, resolved_by = $3, resolved_at = now()
       WHERE id = $1`,
      [existing.id, note, caller.email],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'mismatch.resolved',
      targetType: 'mismatch',
      targetId: existing.id,
      detail: { note },
    });
    const updated = await loadMismatch(tx, existing.id);
    if (updated === null) throw new Error('mismatch vanished');
    return updated;
  });

  res.status(200).json(serialiseMismatch(mismatch));
});
