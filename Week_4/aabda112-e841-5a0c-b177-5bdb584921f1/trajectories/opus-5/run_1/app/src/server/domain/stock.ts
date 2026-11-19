import { endOfClinicDate, serverNow } from '../clock';
import { newId, type Tx } from '../db';
import { AppError } from '../errors';
import { money } from '../format';

export type StockItemRow = {
  id: string;
  clinic_id: string;
  name: string;
  reorder_point: number;
  unit_price_pence: number;
  low_alerted: boolean;
};

export type BatchState = {
  id: string;
  batch: string;
  expiresOn: string;
  remaining: number;
  expired: boolean;
  receivedSeq: number;
};

export type ItemState = {
  onHand: number;
  usable: number;
  batches: BatchState[];
};

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  receive: 'Received',
  expired: 'Expired',
  'invoice-line': 'Invoice line',
  return: 'Returned',
};

function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** A batch is usable through the end of its expiry clinic date. */
export function batchExpired(expiresOn: string, now = serverNow()): boolean {
  return now >= endOfClinicDate(expiresOn);
}

export async function itemState(tx: Tx, itemId: string, now = serverNow()): Promise<ItemState> {
  const rows = await tx.query<{
    id: string;
    batch: string;
    expires_on: Date | string;
    received_seq: string;
    remaining: string | null;
  }>(
    `select b.id, b.batch, b.expires_on, b.received_seq,
            (select coalesce(sum(m.delta), 0) from stock_movements m where m.batch_id = b.id) as remaining
       from stock_batches b
      where b.item_id = $1
      order by b.received_seq`,
    [itemId],
  );
  const batches: BatchState[] = rows.map((row) => {
    const expiresOn = isoDate(row.expires_on);
    return {
      id: row.id,
      batch: row.batch,
      expiresOn,
      remaining: Number(row.remaining ?? 0),
      expired: batchExpired(expiresOn, now),
      receivedSeq: Number(row.received_seq),
    };
  });
  const onHand = batches.reduce((sum, batch) => sum + batch.remaining, 0);
  const usable = batches
    .filter((batch) => !batch.expired)
    .reduce((sum, batch) => sum + batch.remaining, 0);
  return { onHand, usable, batches };
}

async function insertMovement(
  tx: Tx,
  input: {
    itemId: string;
    batchId: string;
    delta: number;
    reason: string;
    invoiceLineId?: string | null;
    pairedMovementId?: string | null;
    byUser: string | null;
    now: number;
    balanceAfter: number;
  },
): Promise<string> {
  const id = newId();
  await tx.query(
    `insert into stock_movements
       (id, item_id, batch_id, delta, reason, invoice_line_id, paired_movement_id, balance_after, by_user, at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      input.itemId,
      input.batchId,
      input.delta,
      input.reason,
      input.invoiceLineId ?? null,
      input.pairedMovementId ?? null,
      input.balanceAfter,
      input.byUser,
      new Date(input.now).toISOString(),
    ],
  );
  return id;
}

export async function lockItem(tx: Tx, itemId: string): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1), 2)', [itemId]);
}

/** Draws a line's quantity first-expiry-first-out, one movement per batch drawn. */
export async function drawForInvoiceLine(
  tx: Tx,
  input: {
    item: StockItemRow;
    quantity: number;
    invoiceLineId: string;
    byUser: string;
    now: number;
  },
): Promise<void> {
  const state = await itemState(tx, input.item.id, input.now);
  if (state.usable < input.quantity) {
    throw new AppError('insufficient_stock', { quantity: state.usable, item: input.item.name });
  }
  const order = state.batches
    .filter((batch) => !batch.expired && batch.remaining > 0)
    .sort((a, b) =>
      a.expiresOn === b.expiresOn
        ? a.receivedSeq - b.receivedSeq
        : a.expiresOn < b.expiresOn
          ? -1
          : 1,
    );
  let remaining = input.quantity;
  let balance = state.onHand;
  for (const batch of order) {
    if (remaining === 0) break;
    const take = Math.min(remaining, batch.remaining);
    remaining -= take;
    balance -= take;
    await insertMovement(tx, {
      itemId: input.item.id,
      batchId: batch.id,
      delta: -take,
      reason: 'invoice-line',
      invoiceLineId: input.invoiceLineId,
      byUser: input.byUser,
      now: input.now,
      balanceAfter: balance,
    });
  }
}

/** Writes one paired return movement for every draw of a line. */
export async function returnInvoiceLineDraws(
  tx: Tx,
  input: { invoiceLineId: string; byUser: string; now: number },
): Promise<void> {
  const draws = await tx.query<{ id: string; item_id: string; batch_id: string; delta: number }>(
    `select id, item_id, batch_id, delta from stock_movements
      where invoice_line_id = $1 and reason = 'invoice-line'
      order by seq`,
    [input.invoiceLineId],
  );
  for (const draw of draws) {
    const already = await tx.one<{ id: string }>(
      'select id from stock_movements where paired_movement_id = $1',
      [draw.id],
    );
    if (already) continue;
    const state = await itemState(tx, draw.item_id, input.now);
    await insertMovement(tx, {
      itemId: draw.item_id,
      batchId: draw.batch_id,
      delta: -draw.delta,
      reason: 'return',
      invoiceLineId: input.invoiceLineId,
      pairedMovementId: draw.id,
      byUser: input.byUser,
      now: input.now,
      balanceAfter: state.onHand - draw.delta,
    });
  }
}

export async function receiveStock(
  tx: Tx,
  input: {
    item: StockItemRow;
    delta: number;
    batch: string;
    expiresOn: string;
    byUser: string | null;
    now: number;
  },
): Promise<void> {
  const existing = await tx.one<{ id: string; expires_on: Date | string }>(
    'select id, expires_on from stock_batches where item_id = $1 and batch = $2',
    [input.item.id, input.batch],
  );
  let batchId: string;
  if (existing) {
    if (isoDate(existing.expires_on) !== input.expiresOn) {
      throw new AppError('validation_failed', {
        field: 'expiresOn',
        label: 'Expires on',
        shape: 'invalid',
      });
    }
    batchId = existing.id;
  } else {
    batchId = newId();
    await tx.query(
      'insert into stock_batches (id, item_id, batch, expires_on) values ($1,$2,$3,$4)',
      [batchId, input.item.id, input.batch, input.expiresOn],
    );
  }
  const state = await itemState(tx, input.item.id, input.now);
  await insertMovement(tx, {
    itemId: input.item.id,
    batchId,
    delta: input.delta,
    reason: 'receive',
    byUser: input.byUser,
    now: input.now,
    balanceAfter: state.onHand + input.delta,
  });
}

export async function writeOffStock(
  tx: Tx,
  input: { item: StockItemRow; delta: number; batch: string; byUser: string | null; now: number },
): Promise<void> {
  const state = await itemState(tx, input.item.id, input.now);
  const batch = state.batches.find((candidate) => candidate.batch === input.batch);
  if (!batch) {
    throw new AppError('validation_failed', { field: 'batch', label: 'Batch', shape: 'invalid' });
  }
  if (batch.remaining < -input.delta) {
    throw new AppError('insufficient_stock', { quantity: batch.remaining, item: input.item.name });
  }
  await insertMovement(tx, {
    itemId: input.item.id,
    batchId: batch.id,
    delta: input.delta,
    reason: 'expired',
    byUser: input.byUser,
    now: input.now,
    balanceAfter: state.onHand + input.delta,
  });
}

export type LowStockCrossing = { itemName: string; usable: number } | null;

/**
 * Keeps the low flag honest and answers the crossing from above to at or below
 * the reorder point, which is announced exactly once.
 */
export async function settleLowStock(
  tx: Tx,
  item: StockItemRow,
  now = serverNow(),
): Promise<LowStockCrossing> {
  const state = await itemState(tx, item.id, now);
  const low = state.usable <= item.reorder_point;
  if (low && !item.low_alerted) {
    await tx.query('update stock_items set low_alerted = true where id = $1', [item.id]);
    return { itemName: item.name, usable: state.usable };
  }
  if (!low && item.low_alerted) {
    await tx.query('update stock_items set low_alerted = false where id = $1', [item.id]);
  }
  return null;
}

export function lowStockAnnouncement(crossing: { itemName: string; usable: number }): string {
  return `${crossing.itemName} is low: ${crossing.usable} left.`;
}

export function signedQuantity(delta: number): string {
  return delta >= 0 ? `+${delta}` : `-${Math.abs(delta)}`;
}

export function movementAnnouncement(delta: number, itemName: string): string {
  return `Recorded ${signedQuantity(delta)} for ${itemName}.`;
}

export function priceText(pence: number): string {
  return money(pence);
}
