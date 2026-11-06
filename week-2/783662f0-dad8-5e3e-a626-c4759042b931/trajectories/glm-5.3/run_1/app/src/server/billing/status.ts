/** The billing status machine: the one place that decides a server's billing state.
 * Kill Bill is the only source of truth; nothing here marks a server paid on its own. */

import type { Pool, Queryer } from "../db/pool.js";
import { config } from "../config.js";
import * as kb from "./killbill.js";
import { Plans } from "../../shared/data.js";
import { isoInstant, planOfPlanName, zoneLabelWithZone } from "../time.js";
import { newId } from "../db/seed.js";

export interface BillingRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  status: string;
  plan: "hamlet" | "borough";
  pending_plan: string | null;
  payment_pending: boolean;
  time_zone: string;
  killbill_account_id: string | null;
  past_due_since: Date | null;
  suspends_at: Date | null;
  kb_balance: string;
  kb_checked_at: Date | null;
  kb_reachable: boolean;
}

export interface BillingState {
  status: "pending_approval" | "active" | "past_due" | "suspended";
  status_word: "PENDING" | "PAYMENT PENDING" | "PAID" | "PAST DUE" | "SUSPENDED";
  plan: "hamlet" | "borough";
  pending_plan: "hamlet" | "borough" | null;
  payment_pending: boolean;
  balance: string;
  currency: "USD";
  past_due_since: string | null;
  suspends_at: string | null;
  suspends_at_label: string | null;
  killbill_account_id: string | null;
  provider_reachable: boolean;
  checked_at: string;
}

export async function loadBillingRowById(pool: Pool, id: string): Promise<BillingRow | null> {
  const res = await pool.query<BillingRow>("SELECT * FROM servers WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

export async function hasPendingPayment(client: Queryer, serverId: string): Promise<boolean> {
  const res = await client.query("SELECT 1 FROM pending_payments WHERE server_id = $1 AND NOT completed LIMIT 1", [serverId]);
  return res.rows.length > 0;
}

export function billingStateOf(row: BillingRow, paymentPending: boolean): BillingState {
  const statusWord: BillingState["status_word"] = paymentPending
    ? "PAYMENT PENDING"
    : row.status === "pending_approval"
      ? "PENDING"
      : row.status === "active"
        ? "PAID"
        : row.status === "past_due"
          ? "PAST DUE"
          : "SUSPENDED";
  return {
    status: row.status as BillingState["status"],
    status_word: statusWord,
    plan: row.plan,
    pending_plan: (row.pending_plan as "hamlet" | "borough" | null) ?? null,
    payment_pending: paymentPending,
    balance: row.kb_balance,
    currency: "USD",
    past_due_since: row.past_due_since === null ? null : isoInstant(row.past_due_since),
    suspends_at: row.suspends_at === null ? null : isoInstant(row.suspends_at),
    suspends_at_label: row.suspends_at === null ? null : zoneLabelWithZone(row.suspends_at, row.time_zone),
    killbill_account_id: row.killbill_account_id,
    provider_reachable: row.kb_reachable,
    checked_at: row.kb_checked_at === null ? isoInstant(new Date()) : isoInstant(row.kb_checked_at),
  };
}

/** The billing state of a server, reading its mirrors. Never reads Kill Bill. */
export async function cachedBillingState(pool: Pool, serverId: string): Promise<BillingState | null> {
  const row = await loadBillingRowById(pool, serverId);
  if (row === null) return null;
  return billingStateOf(row, await hasPendingPayment(pool, serverId));
}

interface InvoiceMirror {
  invoiceId: string;
  number: number;
  amount: string;
  balance: number;
  charged_plan: "hamlet" | "borough" | null;
  creditItems: { itemId: string; amount: number }[];
}

/** Reads Kill Bill live and applies the status machine. Safe to call from any instance. */
export async function refreshBilling(pool: Pool, serverId: string): Promise<{ state: BillingState | null; reachable: boolean }> {
  const row = await loadBillingRowById(pool, serverId);
  if (row === null) return { state: null, reachable: true };
  if (row.killbill_account_id === null) {
    return { state: billingStateOf(row, await hasPendingPayment(pool, serverId)), reachable: row.kb_reachable };
  }
  let invoices: kb.KbInvoice[];
  let reachable = true;
  try {
    invoices = await kb.getInvoicesForAccount(row.killbill_account_id);
  } catch (err) {
    if (err instanceof kb.KillBillError && !err.isOutage) {
      // Slow or interrupted: keep the last confirmed state.
      return { state: billingStateOf(row, await hasPendingPayment(pool, serverId)), reachable: false };
    }
    if (err instanceof kb.KillBillError) {
      await pool.query("UPDATE servers SET kb_reachable = false WHERE id = $1", [serverId]);
      const after = await loadBillingRowById(pool, serverId);
      return { state: after === null ? null : billingStateOf(after, await hasPendingPayment(pool, serverId)), reachable: false };
    }
    throw err;
  }
  const mirrored = await mirrorInvoices(pool, row, invoices);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`billing:${serverId}`]);
    await applyStateMachine(client, row, mirrored, reachable);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const after = await loadBillingRowById(pool, serverId);
  return { state: after === null ? null : billingStateOf(after, await hasPendingPayment(pool, serverId)), reachable: true };
}

/** Mirrors invoices, credit items and payments, queueing each receipt exactly once. */
async function mirrorInvoices(pool: Pool, row: BillingRow, invoices: kb.KbInvoice[]): Promise<InvoiceMirror[]> {
  const client = await pool.connect();
  const mirrored: InvoiceMirror[] = [];
  try {
    await client.query("BEGIN");
    for (const inv of invoices) {
      const recurring = inv.items.find((i) => i.itemType === "RECURRING");
      const chargedPlan = planOfPlanName(recurring?.planName ?? null);
      await client.query(
        `INSERT INTO kb_invoices (invoice_id, server_id, account_id, number, amount, status, charged_plan, charge_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (invoice_id) DO UPDATE SET amount = EXCLUDED.amount, status = EXCLUDED.status, charged_plan = EXCLUDED.charged_plan`,
        [inv.invoiceId, row.id, row.killbill_account_id, inv.invoiceNumber, inv.amount.toFixed(2), inv.status, chargedPlan, inv.invoiceDate]
      );
      for (const item of inv.items) {
        if (item.amount < 0) {
          await client.query(
            `INSERT INTO kb_credits (item_id, server_id, invoice_id, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (item_id) DO NOTHING`,
            [item.invoiceItemId, row.id, inv.invoiceId, item.amount.toFixed(2)]
          );
        }
      }
      const payments = await kb.getInvoicePayments(inv.invoiceId);
      for (const p of payments) {
        const purchase = p.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
        if (purchase === undefined) continue;
        const paidAt = purchase.effectiveDate.slice(0, 10);
        const insertRes = await client.query<{ payment_id: string }>(
          `INSERT INTO kb_payments (payment_id, server_id, invoice_id, external_key, amount, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (payment_id) DO NOTHING RETURNING payment_id`,
          [p.paymentId, row.id, inv.invoiceId, p.paymentExternalKey ?? "", p.purchasedAmount.toFixed(2), paidAt]
        );
        if (insertRes.rows.length > 0) {
          await queueReceiptMail(client, row, p.paymentId, p.purchasedAmount.toFixed(2), chargedPlan ?? row.plan);
        }
      }
      mirrored.push({
        invoiceId: inv.invoiceId,
        number: inv.invoiceNumber,
        amount: inv.amount.toFixed(2),
        balance: inv.balance,
        charged_plan: chargedPlan,
        creditItems: inv.items.filter((i) => i.amount < 0).map((i) => ({ itemId: i.invoiceItemId, amount: i.amount })),
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return mirrored;
}

async function queueReceiptMail(client: Queryer, row: BillingRow, paymentId: string, amount: string, plan: "hamlet" | "borough"): Promise<void> {
  const owner = await client.query<{ email: string; handle: string }>("SELECT email, handle FROM users WHERE id = $1", [row.owner_id]);
  const ownerRow = owner.rows[0];
  if (ownerRow === undefined) return;
  const subject = `Payment confirmed for ${row.name}`;
  const body = `The billing provider confirmed a payment of ${amount} USD for ${row.name}. Plan: ${Plans[plan].name}.`;
  await client.query(
    `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
     SELECT $1,$2,'receipt',$3,$4,$5,$6,'held',$7
     WHERE NOT EXISTS (SELECT 1 FROM mail_outbox WHERE dedupe_key = $7)`,
    [newId(), row.id, ownerRow.handle, ownerRow.email, subject, body, `receipt:${paymentId}`]
  );
}

/** The status table, applied inside a transaction that holds the server's billing lock. */
export async function applyStateMachine(tx: Queryer, row: BillingRow, invoices: InvoiceMirror[], reachable: boolean): Promise<void> {
  const balance = invoices.reduce((sum, i) => sum + i.balance, 0);
  const balanceText = balance.toFixed(2);
  let status = row.status;
  let pastDueSince = row.past_due_since;
  let suspendsAt = row.suspends_at;
  let plan = row.plan;
  let pendingPlan = row.pending_plan;

  if (pendingPlan !== null) {
    const planInvoice = invoices.find((i) => i.charged_plan === pendingPlan);
    if (planInvoice !== undefined && planInvoice.balance <= 0.0001) {
      plan = pendingPlan as "hamlet" | "borough";
      pendingPlan = null;
    }
  }

  const isUnpaidPlanChangeInvoice = (i: InvoiceMirror): boolean =>
    pendingPlan !== null && i.charged_plan === pendingPlan && i.balance > 0.0001;
  const unpaid = invoices.filter((i) => i.balance > 0.0001 && !isUnpaidPlanChangeInvoice(i));

  if (status === "pending_approval") {
    const planInvoice = invoices.find((i) => i.charged_plan === plan);
    if (planInvoice !== undefined && balance <= 0.0001) {
      status = "active";
    }
  } else if (status === "active") {
    if (unpaid.length > 0) {
      status = "past_due";
      pastDueSince = new Date();
      suspendsAt = new Date(Date.now() + config().billingGraceSeconds * 1000);
    }
  } else if (status === "past_due") {
    if (suspendsAt !== null && Date.now() >= suspendsAt.getTime()) {
      status = "suspended";
    } else if (unpaid.length === 0 && balance <= 0.0001) {
      status = "active";
      pastDueSince = null;
      suspendsAt = null;
    }
  } else if (status === "suspended") {
    if (balance <= 0.0001) {
      status = "active";
      pastDueSince = null;
      suspendsAt = null;
    }
  }

  if (status === "past_due") {
    for (const inv of unpaid) {
      await queueOverdueMail(tx, row, suspendsAt, inv.invoiceId);
    }
  }

  const statusChanged = status !== row.status;
  await tx.query(
    `UPDATE servers SET status = $1, plan = $2, pending_plan = $3, past_due_since = $4, suspends_at = $5,
       kb_balance = $6, kb_checked_at = now(), kb_reachable = true WHERE id = $7`,
    [status, plan, pendingPlan, pastDueSince, suspendsAt, balanceText, row.id]
  );
  void reachable;
  if (statusChanged) {
    if (status === "suspended") {
      const { suspendCascade } = await import("../servers/suspension.js");
      await suspendCascade(tx, row.id);
    }
    if (status === "active" && row.status === "suspended") {
      const { reactivateRuns } = await import("../servers/suspension.js");
      await reactivateRuns(tx, row.id);
    }
    await publishServerStatus(tx, row.id);
  }
}

async function queueOverdueMail(tx: Queryer, row: BillingRow, suspendsAt: Date | null, invoiceId: string): Promise<void> {
  const owner = await tx.query<{ email: string; handle: string }>("SELECT email, handle FROM users WHERE id = $1", [row.owner_id]);
  const ownerRow = owner.rows[0];
  if (ownerRow === undefined || suspendsAt === null) return;
  const label = zoneLabelWithZone(suspendsAt, row.time_zone);
  const subject = `Invoice overdue for ${row.name}`;
  const body = [
    `An invoice for ${row.name} is overdue. The server will be suspended at ${label} unless the payment is approved.`,
    `Billing: ${config().publicBase}/s/${row.slug}/billing`,
  ].join("\n");
  await tx.query(
    `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
     SELECT $1,$2,'overdue_warning',$3,$4,$5,$6,'held',$7
     WHERE NOT EXISTS (SELECT 1 FROM mail_outbox WHERE dedupe_key = $7)`,
    [newId(), row.id, ownerRow.handle, ownerRow.email, subject, body, `overdue:${row.id}:${invoiceId}`]
  );
}

export interface PublishableServerPayload {
  kind: "server";
}

/** Publishes the server event so open pages see status changes within 20 seconds. */
export async function publishServerStatus(tx: Queryer, serverId: string): Promise<void> {
  const server = await tx.query<{ slug: string; name: string; owner_id: string; status: string; plan: string; time_zone: string; season: number; suspends_at: Date | null }>(
    "SELECT slug, name, owner_id, status, plan, time_zone, season, suspends_at FROM servers WHERE id = $1",
    [serverId]
  );
  const row = server.rows[0];
  if (row === undefined) return;
  const counts = await tx.query<{ member_count: string; character_count: string }>(
    `SELECT (SELECT count(*) FROM members WHERE server_id = $1)::text AS member_count,
            (SELECT count(*) FROM characters WHERE server_id = $1)::text AS character_count`,
    [serverId]
  );
  const worlds = await tx.query<{ slug: string; name: string }>("SELECT slug, name FROM worlds WHERE server_id = $1 ORDER BY slug", [serverId]);
  const { publishTx } = await import("../api/events.js");
  await publishTx(tx, serverId, [
    {
      kind: "server",
      payload: {
        id: serverId,
        slug: row.slug,
        name: row.name,
        owner: row.owner_id,
        status: row.status,
        suspends_at: row.suspends_at === null ? null : isoInstant(row.suspends_at),
        suspends_at_label: row.suspends_at === null ? null : zoneLabelWithZone(row.suspends_at, row.time_zone),
        time_zone: row.time_zone,
        plan: row.plan,
        season: row.season,
        worlds: worlds.rows,
        member_count: Number(counts.rows[0]?.member_count ?? 0),
        character_count: Number(counts.rows[0]?.character_count ?? 0),
      },
    },
  ]);
}

export async function withBillingLock(pool: Pool, serverId: string, fn: (client: Queryer) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`billing:${serverId}`]);
    await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

