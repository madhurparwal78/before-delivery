import { pool, text, withTransaction } from '../db';
import { lockOrder } from '../data/order-access';
import { computeOrderFigures } from '../domain/figures';
import { ProviderUnavailable } from '../http/errors';
import { recordDepositInvoice } from '../services/billing';
import { ensureBucket } from '../services/storage';

let running = false;

async function recordMissingDeposits(): Promise<void> {
  const pending = await pool.query(
    `select o.id from orders o
       left join order_billing b on b.order_id = o.id
      where o.status not in ('draft','cancelled')
        and (b.order_id is null or b.deposit_recorded_at is null)
      order by o.created_at`,
  );
  for (const row of pending.rows) {
    const orderId = text(row.id);
    try {
      await withTransaction(async (client) => {
        const order = await lockOrder(client, orderId);
        const already = await client.query(
          'select deposit_recorded_at from order_billing where order_id = $1',
          [orderId],
        );
        if (already.rows[0]?.deposit_recorded_at != null) return;
        await recordDepositInvoice(client, order, computeOrderFigures(order));
      });
    } catch (error) {
      if (error instanceof ProviderUnavailable) return;
      throw error;
    }
  }
}

/**
 * Seeded orders past draft get their grower accounts and deposit invoices the
 * first time Kill Bill is reachable, once only.
 */
export async function reconcileSeededBilling(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await recordMissingDeposits();
  } catch (error) {
    console.error('[billing reconcile] retrying after', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export async function ensureStorageBucket(): Promise<void> {
  await ensureBucket().catch(() => undefined);
}
