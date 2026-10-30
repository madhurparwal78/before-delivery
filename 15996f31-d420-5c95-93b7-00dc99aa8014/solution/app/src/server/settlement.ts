// Recording a settlement's grower payment in Kill Bill: once, under the order's row lock, keyed settle-<order id>.
// Used by the settle request and by every instance's queued-settlement retry.

import { audit, pool, type Db } from "./db.js";
import { ApiError } from "./http.js";
import { growerAccount, payInvoice, paymentByKey } from "./services/killbill.js";

interface Queued {
  orderId: string;
  growerId: string;
  balanceInvoiceId: string | null;
  payableCents: number;
}

/** Records the payment (none for a zero payable) and marks the settlement and order settled. */
export async function completeSettlement(db: Db, settlement: Queued, actor: string): Promise<void> {
  let paymentId: string | null = null;
  if (settlement.payableCents > 0) {
    if (settlement.balanceInvoiceId === null) throw new Error(`order ${settlement.orderId} has a payable but no balance invoice`);
    const externalKey = `settle-${settlement.orderId}`;
    paymentId =
      (await paymentByKey(externalKey)) ??
      (await payInvoice(await growerAccount(db, settlement.growerId), settlement.balanceInvoiceId, settlement.payableCents, externalKey));
  }
  await db.query("UPDATE settlements SET status = 'settled', kb_payment_id = $2, settled_at = now() WHERE order_id = $1", [settlement.orderId, paymentId]);
  await db.query("UPDATE orders SET status = 'settled' WHERE id = $1", [settlement.orderId]);
  await audit(db, actor, "settle", "order", settlement.orderId, { payment_id: paymentId });
}

export function isBillingOutage(error: unknown): boolean {
  return error instanceof ApiError && error.code === "billing_unavailable";
}

/** Retries every queued settlement this instance can lock; billing outages leave them queued. */
export async function retryQueuedSettlements(): Promise<void> {
  const { rows: queued } = await pool.query<{ order_id: string }>("SELECT order_id FROM settlements WHERE status = 'queued'");
  for (const { order_id: orderId } of queued) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ grower_id: string; balance_invoice_id: string | null; payable_cents: number }>(
        `SELECT c.grower_id, o.balance_invoice_id, s.payable_cents FROM orders o JOIN orchards c ON c.id = o.orchard_id
           JOIN settlements s ON s.order_id = o.id WHERE o.id = $1 AND s.status = 'queued' FOR UPDATE OF o SKIP LOCKED`,
        [orderId],
      );
      const row = rows[0];
      if (row) {
        await completeSettlement(client, { orderId, growerId: row.grower_id, balanceInvoiceId: row.balance_invoice_id, payableCents: row.payable_cents }, "system");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isBillingOutage(error)) console.error("settlement retry:", error instanceof Error ? error.message : error);
    } finally {
      client.release();
    }
  }
}
