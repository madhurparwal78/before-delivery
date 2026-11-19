import express from 'express';
import { q, one } from '../db.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { batchUsable, fmtDate } from '../domain/stock.js';
import { clinicDateOf } from '../tz.js';

export const router = express.Router();

export async function stockPayload(clinicId: string) {
  const items = await q(
    `select * from stock_items where clinic_id = $1 order by name`,
    [clinicId]
  );
  const out = [];
  for (const item of items.rows) {
    const batches = await q(
      `select b.*, coalesce(sum(m.delta),0)::int as remaining from stock_batches b
       left join stock_movements m on m.batch_id = b.id
       where b.item_id = $1 group by b.id, b.batch, b.expires_on, b.received_order
       order by b.received_order`,
      [item.id]
    );
    let onHand = 0;
    let usable = 0;
    const batchList = batches.rows.map((b: any) => {
      const remaining = Number(b.remaining);
      onHand += remaining;
      const usableNow = batchUsable(fmtDate(b.expires_on)) && remaining > 0;
      if (usableNow) usable += remaining;
      return {
        batch: b.batch,
        expiresOn: fmtDate(b.expires_on),
        remaining,
        expired: !batchUsable(fmtDate(b.expires_on)),
      };
    });
    out.push({
      id: item.id,
      name: item.name,
      onHand,
      usable,
      reorderPoint: item.reorder_point,
      unitPricePence: item.unit_price_pence,
      low: usable <= item.reorder_point,
      batches: batchList,
    });
  }
  return out;
}

router.get('/stock', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  return { status: 200, body: { items: await stockPayload(user.clinicId), now: clockNow().toISOString() } };
}));

router.get('/stock/:id/movements', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const item = await one(
    `select * from stock_items where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!item) throw t('not_found');
  const payload = (await stockPayload(user.clinicId)).find((i: any) => i.id === item.id)!;
  const movements = await q(
    `select m.*, b.batch from stock_movements m
     join stock_batches b on b.id = m.batch_id
     where m.item_id = $1 order by m.at, m.id`,
    [item.id]
  );
  return {
    status: 200,
    body: {
      onHand: payload.onHand,
      usable: payload.usable,
      movements: movements.rows.map((m: any) => ({
        id: m.id,
        delta: m.delta,
        reason: m.reason,
        batch: m.batch,
        invoiceLineId: m.invoice_line_id,
        pairedMovementId: m.paired_movement_id,
        balanceAfter: m.balance_after,
        by: m.by,
        at: new Date(m.at).toISOString(),
      })),
    },
  };
}));

const REASON_LABELS: Record<string, string> = {
  receive: 'Received',
  expired: 'Expired',
  'invoice-line': 'Invoice line',
  return: 'Returned',
};

router.post('/stock/:id/movements', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['manager']);
  const item = await one(
    `select * from stock_items where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!item) throw t('not_found');
  const { delta, reason, batch, expiresOn } = req.body ?? {};
  if (reason !== 'receive' && reason !== 'expired') throw notValid('reason');
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) throw notValid('delta');
  if (reason === 'receive') {
    if (delta <= 0) throw notValid('delta');
    if (typeof batch !== 'string' || batch.trim().length < 1 || batch.trim().length > 40) throw validationError('batch');
    if (typeof expiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw notValid('expiresOn');
    if (expiresOn < clinicDateOf(clockNow())) throw notValid('expiresOn');
  } else {
    if (delta >= 0) throw notValid('delta');
    if (typeof batch !== 'string') throw validationError('batch');
  }
  const existing = await one(
    `select * from stock_batches where item_id = $1 and batch = $2`,
    [item.id, batch.trim()]
  );
  let batchId: string;
  if (reason === 'receive') {
    if (existing) {
      if (fmtDate(existing.expires_on) !== expiresOn) throw notValid('expiresOn');
      batchId = existing.id;
    } else {
      const order = await one(
        `select coalesce(max(received_order),0)::int + 1 as o from stock_batches where item_id = $1`,
        [item.id]
      );
      const r = await q(
        `insert into stock_batches (item_id, batch, expires_on, received_order) values ($1, $2, $3, $4) returning id`,
        [item.id, batch.trim(), expiresOn, order.o]
      );
      batchId = r.rows[0].id;
    }
  } else {
    if (!existing) throw validationError('batch');
    const remaining = await one(
      `select coalesce(sum(m.delta),0)::int as r from stock_movements where batch_id = $1`,
      [existing.id]
    );
    if (-delta > remaining.r) {
      throw t('insufficient_stock', { N: remaining.r, Item: item.name, field: 'delta' });
    }
    batchId = existing.id;
  }
  const bal = await one(
    `select coalesce(sum(m.delta),0)::int as b from stock_movements m
     join stock_batches b2 on b2.id = m.batch_id where b2.item_id = $1`,
    [item.id]
  );
  const r = await q(
    `insert into stock_movements (item_id, batch_id, delta, reason, balance_after, by)
     values ($1, $2, $3, $4, $5, $6) returning id, at`,
    [item.id, batchId, delta, reason, bal.b + delta, user.userId]
  );
  bus.pushClinic(user.clinicId, 'stock', {});
  return {
    status: 201,
    body: {
      id: r.rows[0].id,
      delta,
      reason,
      batch: batch.trim(),
      balanceAfter: bal.b + delta,
      by: user.userId,
      at: new Date(r.rows[0].at).toISOString(),
    },
  };
}));

export { REASON_LABELS };

export default router;
