import type { PoolClient } from "pg";
import { query, transaction } from "../db.js";
import { recordPurchase, recordRefund } from "./killbill.js";
import { ProviderUnavailable } from "./provider.js";

export interface LegRow {
  id: string;
  payment_id: string;
  order_id: string;
  shipment_id: string | null;
  method: string;
  amount_paise: number;
  status: string;
  kb_key: string;
  kb_recorded: boolean;
  card_last4: string | null;
  card_network: string | null;
}

/** Records every confirmed leg and delivered cash that Kill Bill has not seen yet. */
export async function recordPendingPurchases(): Promise<void> {
  const legs = await query<LegRow & { account_id: string }>(
    `SELECT l.*, o.account_id FROM payment_legs l JOIN orders o ON o.id = l.order_id
      WHERE NOT l.kb_recorded AND (
        l.status = 'confirmed'
        OR (l.method = 'cod' AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = l.shipment_id AND s.state = 'delivered')))
      ORDER BY l.seq LIMIT 50`,
  );
  for (const leg of legs) {
    try {
      await recordPurchase(leg.account_id, leg.kb_key, leg.amount_paise);
      await query("UPDATE payment_legs SET kb_recorded = true, status = 'confirmed' WHERE id = $1", [leg.id]);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
}

/** Sends one pending refund leg to Kill Bill, then credits the balance for balance and cash legs. */
async function sendRefundLeg(refundLegId: string): Promise<void> {
  await transaction(async (client: PoolClient) => {
    const found = await client.query(
      `SELECT rl.id, rl.amount_paise, rl.credits_balance, pl.kb_key, pl.kb_recorded, o.account_id
         FROM refund_legs rl JOIN payment_legs pl ON pl.id = rl.leg_id JOIN orders o ON o.id = pl.order_id
        WHERE rl.id = $1 AND rl.status = 'pending' FOR UPDATE OF rl SKIP LOCKED`,
      [refundLegId],
    );
    const leg = found.rows[0] as { id: string; amount_paise: number; credits_balance: boolean; kb_key: string; kb_recorded: boolean; account_id: string } | undefined;
    if (!leg || !leg.kb_recorded) return;
    await recordRefund(leg.kb_key, leg.id, leg.amount_paise);
    await client.query("UPDATE refund_legs SET status = 'recorded', credited = $2 WHERE id = $1", [leg.id, leg.credits_balance]);
    if (leg.credits_balance) await client.query("UPDATE accounts SET balance_paise = balance_paise + $2 WHERE id = $1", [leg.account_id, leg.amount_paise]);
  });
}

export async function recordPendingRefunds(): Promise<void> {
  const pending = await query<{ id: string }>("SELECT id FROM refund_legs WHERE status = 'pending' ORDER BY id LIMIT 50");
  for (const leg of pending) {
    try {
      await sendRefundLeg(leg.id);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
}

/** Tries a refund's legs once now; a refund Kill Bill cannot take yet stays pending for the background pass. */
export async function settleRefund(refundId: string): Promise<void> {
  const legs = await query<{ id: string }>("SELECT id FROM refund_legs WHERE refund_id = $1 ORDER BY id", [refundId]);
  for (const leg of legs) {
    try {
      await sendRefundLeg(leg.id);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
}

/** A checkout that fails after recording legs refunds each of them in full; what Kill Bill refuses now is retried later. */
export async function undoRecordedLegs(recorded: readonly { key: string; amountPaise: number }[]): Promise<void> {
  for (const leg of recorded) {
    const undoKey = `${leg.key}-undo`;
    try {
      await recordRefund(leg.key, undoKey, leg.amountPaise);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
      await query(
        "INSERT INTO pending_reversals (id, payment_key, amount_paise) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [undoKey, leg.key, leg.amountPaise],
      );
    }
  }
}

export async function recordPendingReversals(): Promise<void> {
  const pending = await query<{ id: string; payment_key: string; amount_paise: number }>("SELECT * FROM pending_reversals LIMIT 50");
  for (const reversal of pending) {
    try {
      await recordRefund(reversal.payment_key, reversal.id, reversal.amount_paise);
      await query("DELETE FROM pending_reversals WHERE id = $1", [reversal.id]);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
}
