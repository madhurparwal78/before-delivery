import type { StockReason } from '../shared/domain.js';
import { clinicDate, isIsoDate } from '../shared/clinictime.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { route } from './http.js';
import { publish } from './live.js';
import { loadIn, oneOf, text } from './support.js';

interface ItemTotals {
  id: string;
  clinic_id: string;
  name: string;
  reorder_point: number;
  unit_price_pence: number;
  low_flag: boolean;
  on_hand: number;
  usable: number;
}

/**
 * Stock per item. `on_hand` is the sum of every movement, expired batches included until they are written off;
 * `usable` counts only batches that are not expired: a batch is usable through the end of its expiresOn clinic date.
 * The one expiry rule is the `expires_on >= today` filter.
 */
const TOTALS = `
  SELECT i.id, i.clinic_id, i.name, i.reorder_point, i.unit_price_pence, i.low_flag,
         COALESCE(SUM(m.delta), 0)::int AS on_hand,
         COALESCE(SUM(m.delta) FILTER (WHERE b.expires_on >= $1::date), 0)::int AS usable
    FROM stock_items i
    LEFT JOIN stock_movements m ON m.item_id = i.id
    LEFT JOIN stock_batches b ON b.id = m.batch_id`;

const today = () => clinicDate(now());

async function itemTotals(db: Db, itemId: string): Promise<ItemTotals> {
  return (await one<ItemTotals>(db, `${TOTALS} WHERE i.id = $2 GROUP BY i.id`, [today(), itemId]))!;
}

interface BatchRow {
  id: string;
  name: string;
  expires_on: string;
  remaining: number;
}

async function batchesOf(db: Db, itemId: string): Promise<BatchRow[]> {
  return rows<BatchRow>(
    db,
    `SELECT b.id, b.name, to_char(b.expires_on, 'YYYY-MM-DD') AS expires_on, COALESCE(SUM(m.delta), 0)::int AS remaining
       FROM stock_batches b LEFT JOIN stock_movements m ON m.batch_id = b.id
      WHERE b.item_id = $1 GROUP BY b.id, b.name, b.expires_on, b.seq ORDER BY b.expires_on, b.seq`,
    [itemId],
  );
}

export async function lowFlagsChanged(db: Db, clinicId: string | null): Promise<void> {
  const items = await rows<ItemTotals>(db, `${TOTALS} WHERE ($2::uuid IS NULL OR i.clinic_id = $2) GROUP BY i.id`, [today(), clinicId]);
  for (const item of items) {
    const low = item.usable <= item.reorder_point;
    if (low === item.low_flag) continue;
    const flipped = await one(db, 'UPDATE stock_items SET low_flag = $2 WHERE id = $1 AND low_flag <> $2 RETURNING 1 AS ok', [item.id, low]);
    if (!flipped) continue;
    await publish(db, item.clinic_id, { t: 'stock' });
    if (low) await publish(db, item.clinic_id, { t: 'low', item: item.name, usable: item.usable });
  }
}

async function appendMovement(
  db: Db,
  item: { id: string },
  m: { batchId: string; delta: number; reason: StockReason; by: string | null; invoiceLineId?: string; pairedId?: string },
): Promise<string> {
  const { on_hand } = (await one<{ on_hand: number }>(db, 'SELECT COALESCE(SUM(delta), 0)::int AS on_hand FROM stock_movements WHERE item_id = $1', [item.id]))!;
  const made = await one<{ id: string }>(
    db,
    `INSERT INTO stock_movements (item_id, batch_id, delta, reason, invoice_line_id, paired_movement_id, balance_after, by_user, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [item.id, m.batchId, m.delta, m.reason, m.invoiceLineId ?? null, m.pairedId ?? null, on_hand + m.delta, m.by, now()],
  );
  return made!.id;
}

/** Draw first-expiry-first-out across usable batches, one invoice-line movement per batch drawn. */
export async function drawStock(db: Db, item: { id: string; name: string }, quantity: number, lineId: string, by: string): Promise<void> {
  const usableBatches = (await batchesOf(db, item.id)).filter((b) => b.expires_on >= today() && b.remaining > 0);
  const usable = usableBatches.reduce((sum, b) => sum + b.remaining, 0);
  if (quantity > usable) throw new AppError('insufficient_stock', `Only ${usable} of ${item.name} in stock.`);
  let left = quantity;
  for (const batch of usableBatches) {
    if (left === 0) break;
    const take = Math.min(left, batch.remaining);
    await appendMovement(db, item, { batchId: batch.id, delta: -take, reason: 'invoice-line', by, invoiceLineId: lineId });
    left -= take;
  }
}

/** Return every draw of an invoice line to its own batch through a paired movement. */
export async function returnDraws(db: Db, lineId: string, by: string): Promise<void> {
  const draws = await rows<{ id: string; item_id: string; batch_id: string; delta: number }>(
    db,
    `SELECT d.id, d.item_id, d.batch_id, d.delta FROM stock_movements d
      WHERE d.invoice_line_id = $1 AND d.reason = 'invoice-line'
        AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.paired_movement_id = d.id) ORDER BY d.seq`,
    [lineId],
  );
  for (const draw of draws) {
    await appendMovement(db, { id: draw.item_id }, { batchId: draw.batch_id, delta: -draw.delta, reason: 'return', by, invoiceLineId: lineId, pairedId: draw.id });
  }
}

async function loadItem(db: Db, clinicId: string, id: string) {
  return loadIn<{ id: string; name: string; reorder_point: number }>(db, 'SELECT id, name, reorder_point FROM stock_items WHERE id = $1 AND clinic_id = $2', id, clinicId);
}

export async function createItem(
  db: Db,
  clinicId: string,
  input: { name: string; reorderPoint: number; unitPricePence: number; batches: { batch: string; expiresOn: string; quantity: number }[] },
  by: string | null,
): Promise<string> {
  const item = (await one<{ id: string }>(
    db,
    'INSERT INTO stock_items (clinic_id, name, reorder_point, unit_price_pence) VALUES ($1, $2, $3, $4) RETURNING id',
    [clinicId, input.name, input.reorderPoint, input.unitPricePence],
  ))!;
  for (const b of input.batches) {
    const batch = (await one<{ id: string }>(db, 'INSERT INTO stock_batches (item_id, name, expires_on) VALUES ($1, $2, $3) RETURNING id', [item.id, b.batch, b.expiresOn]))!;
    await appendMovement(db, item, { batchId: batch.id, delta: b.quantity, reason: 'receive', by });
  }
  const totals = await itemTotals(db, item.id);
  await db.query('UPDATE stock_items SET low_flag = $2 WHERE id = $1', [item.id, totals.usable <= totals.reorder_point]);
  return item.id;
}

function shapeItem(item: ItemTotals, batches: BatchRow[], at: string) {
  return {
    id: item.id,
    name: item.name,
    onHand: item.on_hand,
    usable: item.usable,
    reorderPoint: item.reorder_point,
    unitPricePence: item.unit_price_pence,
    low: item.usable <= item.reorder_point,
    batches: batches.map((b) => ({ batch: b.name, expiresOn: b.expires_on, remaining: b.remaining, expired: b.expires_on < at })),
  };
}

export function registerStockRoutes(): void {
  route('GET', '/api/stock', async (ctx) => {
    const user = await ctx.user();
    const items = await rows<ItemTotals>(pool, `${TOTALS} WHERE i.clinic_id = $2 GROUP BY i.id ORDER BY i.name`, [today(), user.clinicId]);
    const at = today();
    ctx.send(200, { items: await Promise.all(items.map(async (item) => shapeItem(item, await batchesOf(pool, item.id), at))) });
  });

  route('GET', '/api/stock/:id/movements', async (ctx) => {
    const user = await ctx.user();
    const item = await loadItem(pool, user.clinicId, ctx.params.id);
    const totals = await itemTotals(pool, item.id);
    const list = await rows<{
      id: string;
      delta: number;
      reason: StockReason;
      batch: string;
      invoice_line_id: string | null;
      paired_movement_id: string | null;
      balance_after: number;
      by_user: string | null;
      at: Date;
    }>(
      pool,
      `SELECT m.id, m.delta, m.reason, b.name AS batch, m.invoice_line_id, m.paired_movement_id, m.balance_after, m.by_user, m.at
         FROM stock_movements m JOIN stock_batches b ON b.id = m.batch_id WHERE m.item_id = $1 ORDER BY m.seq`,
      [item.id],
    );
    ctx.send(200, {
      onHand: totals.on_hand,
      usable: totals.usable,
      movements: list.map((m) => ({
        id: m.id,
        delta: m.delta,
        reason: m.reason,
        batch: m.batch,
        invoiceLineId: m.invoice_line_id,
        pairedMovementId: m.paired_movement_id,
        balanceAfter: m.balance_after,
        by: m.by_user,
        at: m.at.toISOString(),
      })),
    });
  });

  route('POST', '/api/stock/:id/movements', async (ctx) => {
    const user = await ctx.user();
    const item = await loadItem(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'stock.write');
    const body = await ctx.json();
    const created = await transaction(user.clinicId, async (db) => {
      const delta = body.delta;
      if (delta === undefined || delta === null) throw invalid('delta', 'Quantity', true);
      if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) throw invalid('delta', 'Quantity');
      const reason = oneOf(body, 'reason', ['receive', 'expired'] as const);
      if ((reason === 'receive') !== delta > 0) throw invalid('delta', 'Quantity');
      const name = text(body, 'batch', { max: 40 });
      let batchId: string;
      if (reason === 'receive') {
        const expiresOn = body.expiresOn;
        if (expiresOn === undefined || expiresOn === null || expiresOn === '') throw invalid('expiresOn', 'Expires on', true);
        if (!isIsoDate(expiresOn) || expiresOn < today()) throw invalid('expiresOn', 'Expires on');
        const existing = await one<{ id: string; expires_on: string }>(
          db,
          `SELECT id, to_char(expires_on, 'YYYY-MM-DD') AS expires_on FROM stock_batches WHERE item_id = $1 AND name = $2`,
          [item.id, name],
        );
        if (existing && existing.expires_on !== expiresOn) throw invalid('expiresOn', 'Expires on');
        batchId =
          existing?.id ??
          (await one<{ id: string }>(db, 'INSERT INTO stock_batches (item_id, name, expires_on) VALUES ($1, $2, $3) RETURNING id', [item.id, name, expiresOn]))!.id;
      } else {
        const existing = (await batchesOf(db, item.id)).find((b) => b.name === name);
        if (!existing) throw invalid('batch', 'Batch');
        if (-delta > existing.remaining) throw new AppError('insufficient_stock', `Only ${existing.remaining} of ${item.name} in stock.`);
        batchId = existing.id;
      }
      const id = await appendMovement(db, item, { batchId, delta, reason, by: user.id });
      await lowFlagsChanged(db, user.clinicId);
      await publish(db, user.clinicId, { t: 'stock' });
      return { ...(await one(db, `SELECT id, delta, reason, balance_after AS "balanceAfter" FROM stock_movements WHERE id = $1`, [id])), batch: name };
    });
    ctx.send(201, created);
  });
}

