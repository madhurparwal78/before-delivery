import { Router } from 'express';
import { clinicToday, isClinicDate, serverNow } from '../clock';
import { query, transaction } from '../db';
import { invalid } from '../errors';
import { body, created, findInClinic, ok, route } from '../http';
import { requireActor, requireCapability } from '../auth';
import { announce, publish } from '../live';
import {
  itemState,
  lockItem,
  lowStockAnnouncement,
  MOVEMENT_REASON_LABELS,
  receiveStock,
  settleLowStock,
  writeOffStock,
  type StockItemRow,
} from '../domain/stock';

export const stockRouter = Router();

stockRouter.get(
  '/api/stock',
  route(async (request) => {
    const actor = await requireActor(request);
    const rows = await query<StockItemRow>(
      'select * from stock_items where clinic_id = $1 order by sort',
      [actor.clinicId],
    );
    const now = serverNow();
    const items = await transaction(async (tx) => {
      const list = [];
      for (const row of rows) {
        const state = await itemState(tx, row.id, now);
        list.push({
          id: row.id,
          name: row.name,
          onHand: state.onHand,
          usable: state.usable,
          reorderPoint: row.reorder_point,
          unitPricePence: row.unit_price_pence,
          low: state.usable <= row.reorder_point,
          batches: state.batches.map((batch) => ({
            batch: batch.batch,
            expiresOn: batch.expiresOn,
            remaining: batch.remaining,
            expired: batch.expired,
          })),
        });
      }
      return list;
    });
    return ok({ items });
  }),
);

stockRouter.get(
  '/api/stock/:id/movements',
  route(async (request) => {
    const actor = await requireActor(request);
    const item = await findInClinic<StockItemRow>('stock_items', request.params.id, actor.clinicId);
    const now = serverNow();
    const state = await transaction((tx) => itemState(tx, item.id, now));
    const rows = await query<{
      id: string;
      delta: number;
      reason: string;
      batch: string;
      invoice_line_id: string | null;
      paired_movement_id: string | null;
      balance_after: number;
      by_name: string | null;
      by_user: string | null;
      at: Date;
    }>(
      `select m.id, m.delta, m.reason, b.batch, m.invoice_line_id, m.paired_movement_id,
              m.balance_after, m.by_user, u.name as by_name, m.at
         from stock_movements m join stock_batches b on b.id = m.batch_id
         left join users u on u.id = m.by_user
        where m.item_id = $1 order by m.seq`,
      [item.id],
    );
    return ok({
      onHand: state.onHand,
      usable: state.usable,
      movements: rows.map((row) => ({
        id: row.id,
        delta: row.delta,
        reason: row.reason,
        reasonLabel: MOVEMENT_REASON_LABELS[row.reason],
        batch: row.batch,
        invoiceLineId: row.invoice_line_id,
        pairedMovementId: row.paired_movement_id,
        balanceAfter: row.balance_after,
        by: row.by_user,
        byName: row.by_name,
        at: row.at.toISOString(),
      })),
    });
  }),
);

stockRouter.post(
  '/api/stock/:id/movements',
  route(async (request) => {
    const actor = await requireActor(request);
    const item = await findInClinic<StockItemRow>('stock_items', request.params.id, actor.clinicId);
    requireCapability(actor, 'manage.clinic');
    const input = body(request);
    const reason = input.reason;
    if (reason !== 'receive' && reason !== 'expired') throw invalid('reason');
    const delta = input.delta;
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) throw invalid('delta');
    const batch = typeof input.batch === 'string' ? input.batch.trim() : '';
    if (!batch) throw invalid('batch', 'missing');
    if (batch.length > 40) throw invalid('batch');
    const now = serverNow();

    if (reason === 'receive') {
      if (delta < 0) throw invalid('delta');
      if (!isClinicDate(input.expiresOn)) {
        throw invalid('expiresOn', input.expiresOn === undefined ? 'missing' : 'invalid');
      }
      if ((input.expiresOn as string) < clinicToday()) throw invalid('expiresOn');
    } else if (delta > 0) {
      throw invalid('delta');
    }

    const result = await transaction(async (tx) => {
      await lockItem(tx, item.id);
      if (reason === 'receive') {
        await receiveStock(tx, {
          item,
          delta,
          batch,
          expiresOn: input.expiresOn as string,
          byUser: actor.id,
          now,
        });
      } else {
        await writeOffStock(tx, { item, delta, batch, byUser: actor.id, now });
      }
      const crossing = await settleLowStock(tx, item, now);
      const state = await itemState(tx, item.id, now);
      return { crossing, state };
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['stock'] });
    if (result.crossing) {
      announce(actor.clinicId, lowStockAnnouncement(result.crossing), 'manager');
    }
    return created({
      itemId: item.id,
      delta,
      reason,
      batch,
      onHand: result.state.onHand,
      usable: result.state.usable,
    });
  }),
);
