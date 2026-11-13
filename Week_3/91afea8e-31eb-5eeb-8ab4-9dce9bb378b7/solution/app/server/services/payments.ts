import type { PoolClient } from "pg";
import { one, query, transaction } from "../db.js";
import { createRefund } from "./refunds.js";
import { nextPaymentState, type ProviderStatus } from "../domain/state.js";
import { providerStatus } from "./gateway.js";
import { tryStoreDocuments } from "./documents.js";
import { recordPurchase } from "./killbill.js";
import { ProviderUnavailable } from "./provider.js";
import { queueListing } from "./search.js";

interface AwaitingRow {
  id: string;
  order_id: string;
  method: "upi" | "netbanking";
  expires_at: number;
  account_id: string;
}

/** Cancels every shipment of an unpaid order, restores its stock and returns the balance hold. */
async function failPayment(client: PoolClient, payment: AwaitingRow, outcome: "failed" | "expired", nowMs: number): Promise<void> {
  await client.query("UPDATE payments SET status = $2 WHERE id = $1", [payment.id, outcome]);
  await client.query("UPDATE payment_legs SET status = 'failed' WHERE payment_id = $1 AND method <> 'balance'", [payment.id]);
  const shipments = await query<{ id: string }>("SELECT id FROM shipments WHERE order_id = $1 AND state <> 'cancelled' ORDER BY seq", [payment.order_id], client);
  const lines = await query<{ listing_id: string; quantity: number }>(
    "SELECT sl.listing_id, sl.quantity FROM shipment_lines sl JOIN shipments s ON s.id = sl.shipment_id WHERE s.order_id = $1 AND s.state <> 'cancelled'",
    [payment.order_id],
    client,
  );
  for (const line of lines) {
    await client.query("UPDATE listings SET stock = stock + $2 WHERE id = $1", [line.listing_id, line.quantity]);
    await queueListing(line.listing_id, nowMs, client);
  }
  for (const shipment of shipments) {
    await client.query("UPDATE shipments SET state = 'cancelled' WHERE id = $1", [shipment.id]);
    await client.query("INSERT INTO shipment_events (shipment_id, state, at) VALUES ($1, 'cancelled', $2)", [shipment.id, nowMs]);
  }
  const balance = await one<{ amount_paise: number }>("SELECT amount_paise FROM payment_legs WHERE payment_id = $1 AND method = 'balance'", [payment.id], client);
  const first = shipments[0];
  if (balance && first) {
    await createRefund({ orderId: payment.order_id, shipmentId: first.id, lineId: null, returnId: null, source: "payment", quantity: 0, amountPaise: balance.amount_paise }, client);
  }
}

/** Asks the provider for the payment's status; success is recorded in Kill Bill before the payment counts as confirmed. */
export async function refreshPayment(paymentId: string, nowMs: number): Promise<void> {
  const confirmedOrder = await transaction(async (client) => {
    const found = await client.query(
      `SELECT p.id, p.order_id, p.method, p.expires_at, o.account_id FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1 AND p.status = 'awaiting_customer' FOR UPDATE OF p SKIP LOCKED`,
      [paymentId],
    );
    const payment = found.rows[0] as AwaitingRow | undefined;
    if (!payment) return null;
    let provider: ProviderStatus = "PENDING";
    try {
      provider = await providerStatus(payment.method, payment.id);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
    const next = nextPaymentState(provider, nowMs, payment.expires_at);
    if (next === "confirmed") {
      const leg = (await client.query("SELECT id, kb_key, amount_paise FROM payment_legs WHERE payment_id = $1 AND method = $2", [payment.id, payment.method])).rows[0] as
        | { id: string; kb_key: string; amount_paise: number }
        | undefined;
      if (!leg) return null;
      try {
        await recordPurchase(payment.account_id, leg.kb_key, leg.amount_paise);
      } catch (error) {
        if (error instanceof ProviderUnavailable) return null;
        throw error;
      }
      await client.query("UPDATE payment_legs SET kb_recorded = true, status = 'confirmed' WHERE id = $1", [leg.id]);
      await client.query("UPDATE payments SET status = 'confirmed' WHERE id = $1", [payment.id]);
      return payment.order_id;
    }
    if (next !== "awaiting_customer") await failPayment(client, payment, next, nowMs);
    return null;
  });
  if (confirmedOrder) {
    for (const shipment of await query<{ id: string }>("SELECT id FROM shipments WHERE order_id = $1", [confirmedOrder])) await tryStoreDocuments(shipment.id);
  }
}

export async function refreshAwaitingPayments(nowMs: number): Promise<void> {
  const open = await query<{ id: string }>("SELECT id FROM payments WHERE status = 'awaiting_customer' ORDER BY initiated_at LIMIT 50");
  for (const { id } of open) await refreshPayment(id, nowMs);
}
