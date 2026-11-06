/** Payments: the approve-payment flow with the 5-second slow-provider rule, and the settler
 * that finishes pending payments exactly once. One payment per invoice, whatever races. */

import type { Pool, Client } from "../db/pool.js";
import * as kb from "./killbill.js";
import { newId } from "../db/seed.js";
import {
  billingStateOf,
  hasPendingPayment,
  loadBillingRowById,
  refreshBilling,
  type BillingRow,
  type BillingState,
} from "./status.js";

export type SendResult = "sent" | "pending" | "outage";

interface PendingRow {
  id: string;
  server_id: string;
  kind: "invoice" | "coins";
  purchase_id: string | null;
  invoice_id: string;
  external_key: string;
  amount: string;
  owner_id: string;
  attempted_at: Date;
}

/** Sends a payment, honouring the 5-second rule: a pending row is recorded first, and kept
 * only when the provider is slow. A hard outage deletes it and changes nothing. */
async function sendPayment(
  client: Client,
  input: { serverId: string; kind: "invoice" | "coins"; invoiceId: string; externalKey: string; amount: number; purchaseId?: string; ownerId: string },
  send: () => Promise<void>
): Promise<SendResult> {
  const id = newId();
  await client.query(
    `INSERT INTO pending_payments (id, server_id, kind, purchase_id, invoice_id, external_key, amount, owner_id, attempted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    [id, input.serverId, input.kind, input.purchaseId ?? null, input.invoiceId, input.externalKey, input.amount.toFixed(2), input.ownerId]
  );
  try {
    await send();
    // The payment landed: look it back up, then drop the pending row.
    const payment = await kb.getPaymentByExternalKey(input.externalKey);
    if (kb.isPaymentSuccessful(payment)) {
      await client.query("DELETE FROM pending_payments WHERE id = $1", [id]);
      return "sent";
    }
    await client.query("UPDATE pending_payments SET attempted_at = now() WHERE id = $1", [id]);
    return "pending";
  } catch (err) {
    if (err instanceof kb.KillBillError && err.kind === "timeout") {
      await client.query("UPDATE pending_payments SET attempted_at = now() WHERE id = $1", [id]);
      return "pending";
    }
    await client.query("DELETE FROM pending_payments WHERE id = $1", [id]);
    return "outage";
  }
}

export interface ApproveOutcome {
  ok: true;
  status: 200 | 202;
  state: BillingState;
}

export interface ApproveFailure {
  ok: false;
  error: "payment_pending" | "nothing_due" | "unavailable";
}

/** Approve payment, serialised across instances by the server's billing lock. */
export async function approvePayment(pool: Pool, serverId: string): Promise<ApproveOutcome | ApproveFailure> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outcome = await approvePaymentLocked(pool, client, serverId);
    await client.query("COMMIT");
    return outcome;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // transaction already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

async function approvePaymentLocked(pool: Pool, client: Client, serverId: string): Promise<ApproveOutcome | ApproveFailure> {
  {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`billing:${serverId}`]);
    const row = (await client.query<BillingRow>("SELECT * FROM servers WHERE id = $1", [serverId])).rows[0];
    if (row === undefined || row.killbill_account_id === null) {
      return { ok: false, error: "nothing_due" };
    }
    if (await hasPendingPayment(client, serverId)) {
      return { ok: false, error: "payment_pending" };
    }
    let invoices: kb.KbInvoice[] = [];
    try {
      invoices = await listInvoicesWithWait(row);
    } catch {
      return { ok: false, error: "unavailable" };
    }
    const unpaid = invoices.filter((i) => i.balance > 0.0001);
    if (unpaid.length === 0) {
      return { ok: true, status: 200, state: (await refreshStateAfterCommit(pool, serverId))! };
    }
    let anyPending = false;
    let anyOutage = false;
    for (const inv of unpaid) {
      const externalKey = `pw-pay-${inv.invoiceId}`;
      const existing = await kb.getPaymentByExternalKey(externalKey);
      if (kb.isPaymentSuccessful(existing)) continue;
      const result = await sendPayment(
        client,
        { serverId, kind: "invoice", invoiceId: inv.invoiceId, externalKey, amount: inv.balance, ownerId: row.owner_id },
        async () => {
          await kb.payInvoiceExternally(row.killbill_account_id!, inv.invoiceId, inv.balance, externalKey);
        }
      );
      if (result === "pending") anyPending = true;
      if (result === "outage") anyOutage = true;
    }
    if (anyOutage && !anyPending) {
      return { ok: false, error: "unavailable" };
    }
    if (anyPending) {
      const after = await loadBillingRowById(pool, serverId);
      const state = billingStateOf(after!, true);
      return { ok: true, status: 202, state };
    }
    return { ok: true, status: 200, state: (await refreshStateAfterCommit(pool, serverId))! };
  }
}

async function refreshStateAfterCommit(pool: Pool, serverId: string): Promise<BillingState | null> {
  const row = await loadBillingRowById(pool, serverId);
  if (row === null) return null;
  return billingStateOf(row, await hasPendingPayment(pool, serverId));
}

/** Waits up to 10 seconds for a pending server's plan invoice to be issued. */
async function listInvoicesWithWait(row: BillingRow): Promise<kb.KbInvoice[]> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const invoices = await kb.getInvoicesForAccount(row.killbill_account_id!);
    if (invoices.length > 0 || Date.now() >= deadline) return invoices;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The settler: claims each pending payment with a row lock, so one instance handles it at a time.
 * Runs at least every 5 seconds on every instance. */
export async function settlePendingPayments(pool: Pool): Promise<void> {
  const claimed = await pool.query<PendingRow>(
    `UPDATE pending_payments SET claimed_until = now() + interval '30 seconds'
     WHERE id IN (
       SELECT id FROM pending_payments
       WHERE NOT completed AND (claimed_until IS NULL OR claimed_until < now())
       ORDER BY attempted_at LIMIT 5
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, server_id, kind, purchase_id, invoice_id, external_key, amount, owner_id, attempted_at`
  );
  for (const row of claimed.rows) {
    await settleOne(pool, row);
  }
}

async function settleOne(pool: Pool, row: PendingRow): Promise<void> {
  try {
    const payment = await kb.getPaymentByExternalKey(row.external_key);
    if (kb.isPaymentSuccessful(payment)) {
      await adoptPendingPayment(pool, row);
      return;
    }
    if (Date.now() - row.attempted_at.getTime() >= 30000) {
      await resendPendingPayment(pool, row);
      await pool.query("UPDATE pending_payments SET attempted_at = now(), claimed_until = NULL WHERE id = $1", [row.id]);
    } else {
      await pool.query("UPDATE pending_payments SET claimed_until = NULL WHERE id = $1", [row.id]);
    }
  } catch (err) {
    if (err instanceof kb.KillBillError) {
      await pool.query("UPDATE pending_payments SET claimed_until = NULL WHERE id = $1", [row.id]);
      return;
    }
    throw err;
  }
}

async function resendPendingPayment(pool: Pool, row: PendingRow): Promise<void> {
  if (row.kind === "invoice") {
    const server = await loadBillingRowById(pool, row.server_id);
    if (server === null || server.killbill_account_id === null) return;
    try {
      await kb.payInvoiceExternally(server.killbill_account_id, row.invoice_id, Number(row.amount), row.external_key);
    } catch {
      return;
    }
    return;
  }
  const { completeCoinPurchase } = await import("../coins/purchases.js");
  await completeCoinPurchase(pool, row.purchase_id ?? "", row.external_key);
}

async function adoptPendingPayment(pool: Pool, row: PendingRow): Promise<void> {
  if (row.kind === "coins") {
    const { completeCoinPurchase } = await import("../coins/purchases.js");
    await completeCoinPurchase(pool, row.purchase_id ?? "", row.external_key);
  }
  await pool.query("DELETE FROM pending_payments WHERE id = $1", [row.id]);
  if (row.kind === "invoice") {
    await refreshBilling(pool, row.server_id);
  }
}
