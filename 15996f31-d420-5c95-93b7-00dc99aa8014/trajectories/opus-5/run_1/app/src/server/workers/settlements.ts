import { int, pool, text } from '../db';
import { completeSettlement } from '../routes/orders';

const RETRY_SECONDS = 10;
let running = false;

async function claimAndComplete(): Promise<void> {
  for (;;) {
    /* The lease only covers this attempt, so a crashed instance frees the row. */
    const claimed = await pool.query(
      `update settlements set next_attempt_at = now() + ($1 || ' seconds')::interval
        where order_id = (
          select order_id from settlements
           where status = 'queued' and next_attempt_at <= now()
           order by created_at limit 1 for update skip locked)
        returning order_id, payable_cents`,
      [String(RETRY_SECONDS)],
    );
    const row = claimed.rows[0];
    if (row === undefined) return;
    const orderId = text(row.order_id);
    const settled = await completeSettlement(orderId, int(row.payable_cents), null);
    if (settled) continue;
    /* Billing is unreachable from here; release it so another instance may finish it. */
    await pool.query(
      `update settlements set next_attempt_at = now() where order_id = $1 and status = 'queued'`,
      [orderId],
    );
    return;
  }
}

/** Retries queued settlements; any running instance may finish one. */
export async function pumpQueuedSettlements(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await claimAndComplete();
  } catch (error) {
    console.error('[queued settlements] retrying after', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}
