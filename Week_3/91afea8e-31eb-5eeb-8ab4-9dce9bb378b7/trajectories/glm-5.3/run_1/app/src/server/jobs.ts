import { query, one, withTransaction } from "./db.js";
import { buildInvoicePdf, buildLabelPdf } from "./documents.js";
import { putObject } from "./storage.js";
import { istDateString, futureIso } from "./time.js";
import { startUpiCollect, upiStatus, startNetBanking, netBankingStatus } from "./providers.js";
import { kbRecordPurchase, kbRecordRefund, ensureKbAccount } from "./killbill.js";
import { claimPass } from "./indexer.js";

/**
 * One document pass: build and store invoices and labels once, then mark them ready.
 * Documents are never regenerated once stored.
 */
export async function documentPass(): Promise<void> {
  const shipments = await query<{ shipment_id: string; order_id: string; seller_id: string; state: string; payment_method: string; invoice_status: string; label_status: string; cod_fee_paise: string; delivery_fee_paise: string; gift_wrap_paise: string }>(`
    SELECT s.*, p.method AS payment_method FROM shipments s
    JOIN payments p ON p.order_id = s.order_id
    WHERE (s.invoice_status = 'pending' OR s.label_status = 'pending') AND s.state <> 'cancelled'`);
  for (const shipment of shipments) {
    const paid = shipment.payment_method === "cod" || await orderPaid(shipment.order_id);
    if (!paid) continue;
    if (shipment.invoice_status === "pending") {
      await storeInvoice(shipment);
    }
    if (shipment.label_status === "pending") {
      await storeLabel(shipment);
    }
  }
}

async function orderPaid(orderId: string): Promise<boolean> {
  const legs = await query<{ status: string }>(
    "SELECT status FROM payment_legs WHERE payment_id = (SELECT payment_id FROM payments WHERE order_id = $1)", [orderId]);
  const awaiting = await one<{ status: string }>("SELECT status FROM payments WHERE order_id = $1", [orderId]);
  if (awaiting?.status !== "confirmed") return false;
  return legs.every((l) => l.status === "confirmed");
}

async function storeInvoice(shipment: { shipment_id: string; order_id: string }): Promise<void> {
  const key = `invoices/${shipment.order_id}/${shipment.shipment_id}.pdf`;
  const existing = await one<{ object_key: string }>("SELECT object_key FROM documents WHERE object_key = $1", [key]);
  if (existing) {
    await query("UPDATE shipments SET invoice_status = 'ready' WHERE shipment_id = $1", [shipment.shipment_id]);
    return;
  }
  const { shipmentViewsForOrder } = await import("./api_orders.js");
  const views = (await shipmentViewsForOrder(shipment.order_id)) as Array<Record<string, unknown>>;
  const view = views.find((v) => v.shipment_id === shipment.shipment_id);
  if (!view) return;
  const seller = await one<{ name: string; gstin: string; pickup_city: string; pickup_state: string }>(
    "SELECT * FROM sellers WHERE seller_id = (SELECT seller_id FROM shipments WHERE shipment_id = $1)", [shipment.shipment_id]);
  const order = await one<{ order_id: string; address_snapshot: Record<string, unknown> }>(
    "SELECT * FROM orders WHERE order_id = $1", [shipment.order_id]);
  const pdf = buildInvoicePdf(
    view as never,
    seller!,
    { order_id: order!.order_id, address: order!.address_snapshot as never },
  );
  const stored = await putObject(key, pdf, "application/pdf");
  if (!stored) return;
  await withTransaction(async (client) => {
    await client.query("INSERT INTO documents (object_key, kind, shipment_id) VALUES ($1,'invoice',$2) ON CONFLICT DO NOTHING", [key, shipment.shipment_id]);
    await client.query("UPDATE shipments SET invoice_status = 'ready' WHERE shipment_id = $1", [shipment.shipment_id]);
  });
}

async function storeLabel(shipment: { shipment_id: string; order_id: string }): Promise<void> {
  const key = `labels/${shipment.order_id}/${shipment.shipment_id}.pdf`;
  const existing = await one<{ object_key: string }>("SELECT object_key FROM documents WHERE object_key = $1", [key]);
  if (existing) {
    await query("UPDATE shipments SET label_status = 'ready' WHERE shipment_id = $1", [shipment.shipment_id]);
    return;
  }
  const { sellerShipmentView } = await import("./api_orders.js");
  const view = await sellerShipmentView(shipment.shipment_id);
  const order = await one<{ address_snapshot: Record<string, unknown>; due_paise: string }>(
    "SELECT * FROM orders WHERE order_id = $1", [shipment.order_id]);
  const payment = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [shipment.order_id]);
  const address = order!.address_snapshot as { name: string; line1: string; line2: string; city: string; pincode: string; phone: string };
  const seller = await one<{ name: string; pickup_city: string }>(
    "SELECT name, pickup_city FROM sellers WHERE seller_id = (SELECT seller_id FROM shipments WHERE shipment_id = $1)", [shipment.shipment_id]);
  const collect = payment?.method === "cod" ? Number(order!.due_paise) : null;
  const pdf = buildLabelPdf(view as never, address, seller!, collect);
  const stored = await putObject(key, pdf, "application/pdf");
  if (!stored) return;
  await withTransaction(async (client) => {
    await client.query("INSERT INTO documents (object_key, kind, shipment_id) VALUES ($1,'label',$2) ON CONFLICT DO NOTHING", [key, shipment.shipment_id]);
    await client.query("UPDATE shipments SET label_status = 'ready' WHERE shipment_id = $1", [shipment.shipment_id]);
  });
}

/** UPI and net-banking payments: poll the provider, record the charge, or expire. */
export async function paymentPass(): Promise<void> {
  const pending = await query<{ payment_id: string; order_id: string; method: string; expires_at: string; initiated_at: string }>(`
    SELECT p.* FROM payments p
    JOIN orders o ON o.order_id = p.order_id
    WHERE p.status = 'awaiting_customer'`);
  for (const payment of pending) {
    const status = payment.method === "upi"
      ? await upiStatus(payment.payment_id)
      : payment.method === "netbanking"
        ? await netBankingStatus(payment.payment_id)
        : "PENDING";
    if (status === "SUCCESS") {
      const legs = await query<{ leg_id: string; method: string; amount_paise: string; kb_txn_key: string; status: string }>(
        "SELECT * FROM payment_legs WHERE payment_id = $1", [payment.payment_id]);
      const order = await one<{ account_id: string; name: string; idem_key: string }>(`
        SELECT o.*, sh.name FROM orders o JOIN shoppers sh ON sh.account_id = o.account_id WHERE o.order_id = $1`, [payment.order_id]);
      const kbAccount = order ? await ensureKbAccount(order.account_id, order.name) : null;
      let allConfirmed = true;
      for (const leg of legs) {
        if (leg.status === "confirmed") continue;
        if (!kbAccount) { allConfirmed = false; continue; }
        const recorded = await kbRecordPurchase(kbAccount, Number(leg.amount_paise), leg.kb_txn_key, leg.kb_txn_key);
        if (recorded.ok) {
          await query("UPDATE payment_legs SET status = 'confirmed', kb_payment_id = $2 WHERE leg_id = $1", [leg.leg_id, recorded.paymentId]);
        } else {
          allConfirmed = false;
        }
      }
      if (allConfirmed) {
        await query("UPDATE payments SET status = 'confirmed' WHERE payment_id = $1", [payment.payment_id]);
        await query("UPDATE orders SET status = 'placed' WHERE order_id = $1", [payment.order_id]);
        await query("INSERT INTO order_timeline (order_id, state, at) VALUES ($1,'placed',now()) ON CONFLICT DO NOTHING", [payment.order_id]);
        // generate documents now that payment is confirmed
        await documentPass();
      }
    } else if (status === "FAILED" || Date.now() >= new Date(payment.expires_at).getTime()) {
      await expirePayment(payment);
    }
  }
}

async function expirePayment(payment: { payment_id: string; order_id: string }): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("UPDATE payments SET status = CASE WHEN $2::text = 'failed' THEN 'failed' ELSE 'expired' END WHERE payment_id = $1", [payment.payment_id, "expired"]);
    const shipments = (await client.query("SELECT shipment_id, state FROM shipments WHERE order_id = $1", [payment.order_id])).rows as Array<{ shipment_id: string; state: string }>;
    for (const s of shipments) {
      if (s.state === "cancelled") continue;
      await client.query("UPDATE shipments SET state = 'cancelled' WHERE shipment_id = $1", [s.shipment_id]);
      await client.query("INSERT INTO shipment_timeline (shipment_id, state, at) VALUES ($1,'cancelled',now()) ON CONFLICT DO NOTHING", [s.shipment_id]);
      const lines = (await client.query("SELECT listing_id, quantity FROM shipment_lines WHERE shipment_id = $1", [s.shipment_id])).rows as Array<{ listing_id: string; quantity: number }>;
      for (const line of lines) {
        await client.query("UPDATE listings SET stock = stock + $2 WHERE listing_id = $1", [line.listing_id, line.quantity]);
      }
    }
    // return the balance hold
    const balanceLeg = (await client.query("SELECT amount_paise FROM payment_legs WHERE payment_id = $1 AND method = 'balance'", [payment.payment_id])).rows[0] as { amount_paise: string } | undefined;
    if (balanceLeg) {
      await client.query(
        "UPDATE shoppers SET balance_hold_paise = greatest(balance_hold_paise - $2, 0) WHERE account_id = (SELECT account_id FROM orders WHERE order_id = $1)",
        [payment.order_id, Number(balanceLeg.amount_paise)],
      );
    }
  });
}

/** Pending refunds: record them in Kill Bill once it answers. */
export async function refundPass(): Promise<void> {
  const legs = await query<{ refund_leg_id: string; refund_id: string; method: string; amount_paise: string; kb_payment_id: string | null; kb_txn_key: string }>(`
    SELECT rl.* FROM refund_legs rl
    WHERE rl.status = 'pending' AND rl.kb_payment_id IS NOT NULL`);
  for (const leg of legs) {
    if (!leg.kb_payment_id) continue;
    const ok = await kbRecordRefund(leg.kb_payment_id, Number(leg.amount_paise), leg.kb_txn_key);
    if (ok) {
      await query("UPDATE refund_legs SET status = 'confirmed' WHERE refund_leg_id = $1", [leg.refund_leg_id]);
      const remaining = await one<{ n: string }>(
        "SELECT count(*) AS n FROM refund_legs WHERE refund_id = $1 AND status <> 'confirmed'", [leg.refund_id]);
      if (Number(remaining?.n ?? 0) === 0) {
        await query("UPDATE refunds SET state = 'confirmed' WHERE refund_id = $1", [leg.refund_id]);
        await query("UPDATE returns SET state = 'picked', updated_at = now() WHERE return_id = $1", [leg.refund_id]);
      }
    }
  }
}

/** COD collections recorded when a shipment is delivered; at most once per external key. */
export async function codPass(): Promise<void> {
  const rows = await query<{ shipment_id: string; order_id: string; account_id: string; name: string; due_paise: string }>(`
    SELECT s.shipment_id, s.order_id, o.account_id, sh.name, o.due_paise
    FROM shipments s JOIN orders o ON o.order_id = s.order_id JOIN shoppers sh ON sh.account_id = o.account_id
    JOIN payments p ON p.order_id = o.order_id
    WHERE s.state = 'delivered' AND p.method = 'cod'
      AND NOT EXISTS (
        SELECT 1 FROM payment_legs pl WHERE pl.payment_id = p.payment_id
          AND pl.method = 'cod' AND pl.status = 'confirmed' AND pl.shipment_id = s.shipment_id
      )`);
  for (const row of rows) {
    const kbAccount = await ensureKbAccount(row.account_id, row.name);
    if (!kbAccount) continue;
    const amount = Number(row.due_paise);
    if (amount <= 0) continue;
    const legKey = `${row.order_id}-cod-${row.shipment_id}`;
    const payment = await one<{ payment_id: string }>("SELECT payment_id FROM payments WHERE order_id = $1", [row.order_id]);
    const recorded = await kbRecordPurchase(kbAccount, amount, legKey, legKey);
    if (recorded.ok && payment) {
      await query(
        `INSERT INTO payment_legs (leg_id, payment_id, method, amount_paise, status, kb_payment_id, kb_txn_key, shipment_id)
         VALUES ($1,$2,'cod',$3,'confirmed',$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [`cod-${row.shipment_id}`, payment.payment_id, amount, recorded.paymentId, legKey, row.shipment_id],
      );
    }
  }
}

/** Run all passes, coordinated so several instances never duplicate work. */
export async function runAllPasses(): Promise<void> {
  await claimPass("documents", documentPass);
  await claimPass("payments", paymentPass);
  await claimPass("refunds", refundPass);
  await claimPass("cod", codPass);
}

export function startBackgroundLoops(): void {
  setInterval(() => {
    runAllPasses().catch((e) => console.error("background pass error", e));
  }, 5000).unref();
  setInterval(async () => {
    const { reindexAll } = await import("./indexer.js");
    await reindexAll().catch(() => undefined);
  }, 60_000).unref();
}
