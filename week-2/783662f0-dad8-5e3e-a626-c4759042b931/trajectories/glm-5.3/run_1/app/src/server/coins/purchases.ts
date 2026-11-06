/** Coin purchases: three-step checkout, Kill Bill external payments with the pw-coins key,
 * the daily limit and refunds. */

import type { Pool, Client } from "../db/pool.js";
import { CoinPacks } from "../../shared/data.js";
import { newId } from "../db/seed.js";
import * as kb from "../billing/killbill.js";
import { writeLedgerEntry, balanceOf } from "./ledger.js";
import { isoInstant, zoneDate } from "../time.js";

export type PurchaseError = "daily_limit_reached" | "billing_unavailable" | "not_paid" | "already_refunded" | "coins_spent" | "unknown";

export interface PurchaseRow {
  id: string;
  server_id: string;
  character_id: string;
  user_id: string;
  pack: string;
  coins: number;
  price: string;
  state: "pending" | "paid" | "refunded";
  receipt: "sent" | "held";
  created_at: Date;
  paid_at: Date | null;
}

export function packOf(pack: string): { coins: number; price: string } | null {
  const found = CoinPacks.find((p) => p.pack === pack);
  return found === undefined ? null : { coins: found.coins, price: found.price };
}

export interface PurchaseOutcome {
  ok: true;
  status: 201 | 202;
  purchase: PurchaseRow;
}

export interface PurchaseFailure {
  ok: false;
  error: PurchaseError;
}

/** Creates a purchase and pays it through Kill Bill with the pw-coins-<purchase id> key. */
export async function createPurchase(
  pool: Pool,
  input: { serverId: string; timeZone: string; userId: string; handle: string; email: string; characterId: string; characterName: string; pack: string; serverName: string }
): Promise<PurchaseOutcome | PurchaseFailure> {
  const pack = packOf(input.pack);
  if (pack === null) return { ok: false, error: "unknown" };
  const purchaseId = newId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The per-user lock makes parallel attempts never pass the daily limit.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`coins:${input.userId}:${input.serverId}`]);
    const today = zoneDate(new Date(), input.timeZone);
    const counted = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM coin_purchases
       WHERE user_id = $1 AND server_id = $2 AND ((created_at AT TIME ZONE $3)::date = $4::date)`,
      [input.userId, input.serverId, input.timeZone, today]
    );
    if (Number(counted.rows[0]?.n ?? 0) >= 5) {
      await client.query("ROLLBACK");
      return { ok: false, error: "daily_limit_reached" };
    }
    const inserted = await client.query(
      `INSERT INTO coin_purchases (id, server_id, character_id, user_id, pack, coins, price, state, receipt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','held')`,
      [purchaseId, input.serverId, input.characterId, input.userId, input.pack, pack.coins, pack.price]
    );
    void inserted;
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }

  // Kill Bill: the buyer's account per server, with the AUTO_PAY_OFF tag and an external payment method.
  let methodId: string | null = null;
  try {
    methodId = await ensureBuyerMethod(pool, input.serverId, input.handle, input.serverName);
  } catch (err) {
    await deletePurchase(pool, purchaseId);
    if (err instanceof kb.KillBillError) return { ok: false, error: "billing_unavailable" };
    throw err;
  }

  const externalKey = `pw-coins-${purchaseId}`;
  const pendingId = newId();
  await pool.query(
    `INSERT INTO pending_payments (id, server_id, kind, purchase_id, invoice_id, external_key, amount, owner_id, attempted_at)
     VALUES ($1,$2,'coins',$3,'',$4,$5,$6,now())`,
    [pendingId, input.serverId, purchaseId, externalKey, pack.price, input.userId]
  );
  const buyerExternal = `plotwright-${input.serverId}-${input.handle}`;
  const buyerAccount = await pool.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [buyerExternal]);
  try {
    await kb.payAccountExternally(buyerAccount.rows[0]!.account_id, methodId, Number(pack.price), externalKey);
    const payment = await kb.getPaymentByExternalKey(externalKey);
    if (kb.isPaymentSuccessful(payment)) {
      await pool.query("DELETE FROM pending_payments WHERE id = $1", [pendingId]);
      await completeCoinPurchase(pool, purchaseId, externalKey);
      const purchase = await loadPurchase(pool, purchaseId);
      return purchase === null ? { ok: false, error: "unknown" } : { ok: true, status: 201, purchase };
    }
    await pool.query("UPDATE pending_payments SET attempted_at = now() WHERE id = $1", [pendingId]);
    const purchase = await loadPurchase(pool, purchaseId);
    return purchase === null ? { ok: false, error: "unknown" } : { ok: true, status: 202, purchase };
  } catch (err) {
    if (err instanceof kb.KillBillError && err.kind === "timeout") {
      await pool.query("UPDATE pending_payments SET attempted_at = now() WHERE id = $1", [pendingId]);
      const purchase = await loadPurchase(pool, purchaseId);
      return purchase === null ? { ok: false, error: "unknown" } : { ok: true, status: 202, purchase };
    }
    await pool.query("DELETE FROM pending_payments WHERE id = $1", [pendingId]);
    await deletePurchase(pool, purchaseId);
    if (err instanceof kb.KillBillError) return { ok: false, error: "billing_unavailable" };
    throw err;
  }
}

async function deletePurchase(pool: Pool, purchaseId: string): Promise<void> {
  await pool.query("DELETE FROM coin_purchases WHERE id = $1", [purchaseId]);
}

export async function loadPurchase(pool: Pool | Client, purchaseId: string): Promise<PurchaseRow | null> {
  const res = await pool.query<PurchaseRow>("SELECT * FROM coin_purchases WHERE id = $1", [purchaseId]);
  return res.rows[0] ?? null;
}

/** The buyer's Kill Bill account for this server, with tag and payment method. */
async function ensureBuyerMethod(pool: Pool, serverId: string, handle: string, serverName: string): Promise<string> {
  const externalKey = `plotwright-${serverId}-${handle}`;
  let accountId: string | null = null;
  const existing = await pool.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [externalKey]);
  if (existing.rows.length > 0) {
    accountId = existing.rows[0]!.account_id;
  } else {
    const account = await kb.createAccount(externalKey, `${handle}`);
    await kb.addAutoPayOffTag(account.accountId);
    await pool.query("INSERT INTO kb_accounts (external_key, account_id, kind) VALUES ($1,$2,'buyer')", [externalKey, account.accountId]);
    accountId = account.accountId;
  }
  void serverName;
  const methodKey = `${externalKey}:method`;
  const method = await pool.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [methodKey]);
  if (method.rows.length > 0) return method.rows[0]!.account_id;
  const methodId = await kb.createExternalPaymentMethod(accountId);
  await pool.query("INSERT INTO kb_accounts (external_key, account_id, kind) VALUES ($1,$2,'buyer')", [methodKey, methodId]);
  return methodId;
}

/** Credits the coins and queues the receipt, exactly once, after Kill Bill confirms the payment. */
export async function completeCoinPurchase(pool: Pool, purchaseId: string, externalKey: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const purchase = (await client.query<PurchaseRow>("SELECT * FROM coin_purchases WHERE id = $1 FOR UPDATE", [purchaseId])).rows[0];
    if (purchase === undefined || purchase.state !== "pending") {
      await client.query("COMMIT");
      return;
    }
    const payment = await kb.getPaymentByExternalKey(externalKey);
    if (!kb.isPaymentSuccessful(payment)) {
      await client.query("COMMIT");
      return;
    }
    await writeLedgerEntry(client, {
      serverId: purchase.server_id,
      kind: "top_up",
      purchaseId: purchase.id,
      lines: [
        { account: "house", amount: -purchase.coins },
        { account: purchase.character_id, amount: purchase.coins },
      ],
    });
    await client.query("UPDATE coin_purchases SET state = 'paid', paid_at = now(), killbill_payment_id = $2, killbill_payment_attempted_at = now() WHERE id = $1", [
      purchase.id,
      payment!.paymentId,
    ]);
    const character = await client.query<{ name: string }>("SELECT name FROM characters WHERE id = $1", [purchase.character_id]);
    const buyer = await client.query<{ email: string; handle: string }>("SELECT email, handle FROM users WHERE id = $1", [purchase.user_id]);
    const server = await client.query<{ name: string }>("SELECT name FROM servers WHERE id = $1", [purchase.server_id]);
    if (buyer.rows[0] !== undefined && character.rows[0] !== undefined && server.rows[0] !== undefined) {
      await client.query(
        `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
         VALUES ($1,$2,'coin_receipt',$3,$4,$5,$6,'held',$7)`,
        [
          newId(),
          purchase.server_id,
          buyer.rows[0].handle,
          buyer.rows[0].email,
          `Coins added on ${server.rows[0].name}`,
          `${character.rows[0].name} received ${purchase.coins} coins for ${purchase.price} USD.`,
          `coin_receipt:${purchase.id}`,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

export type RefundOutcome = { ok: true; purchase: PurchaseRow } | { ok: false; error: PurchaseError };

/** Refunds an unspent purchase through Kill Bill with the pw-refund-<purchase id> key. */
export async function refundPurchase(pool: Pool, purchaseId: string): Promise<RefundOutcome> {
  const client = await pool.connect();
  let purchase: PurchaseRow | null = null;
  try {
    await client.query("BEGIN");
    const locked = (await client.query<PurchaseRow>("SELECT * FROM coin_purchases WHERE id = $1 FOR UPDATE", [purchaseId])).rows[0];
    if (locked === undefined || locked.state !== "paid") {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_paid" };
    }
    purchase = locked;
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }

  try {
    const kbPayment = await kb.getPaymentByExternalKey(`pw-coins-${purchaseId}`);
    if (kbPayment === null) return { ok: false, error: "not_paid" };
    await kb.refundPayment(kbPayment.paymentId, Number(purchase.price), `pw-refund-${purchaseId}`);
  } catch (err) {
    if (err instanceof kb.KillBillError) return { ok: false, error: "billing_unavailable" };
    throw err;
  }

  const client2 = await pool.connect();
  try {
    await client2.query("BEGIN");
    const locked = (await client2.query<PurchaseRow>("SELECT * FROM coin_purchases WHERE id = $1 FOR UPDATE", [purchaseId])).rows[0];
    if (locked === undefined) {
      await client2.query("ROLLBACK");
      return { ok: false, error: "not_paid" };
    }
    if (locked.state === "refunded") {
      await client2.query("ROLLBACK");
      return { ok: false, error: "already_refunded" };
    }
    if (locked.state !== "paid") {
      await client2.query("ROLLBACK");
      return { ok: false, error: "not_paid" };
    }
    const balance = await balanceOf(client2, locked.character_id);
    if (balance < locked.coins) {
      await client2.query("ROLLBACK");
      return { ok: false, error: "coins_spent" };
    }
    await writeLedgerEntry(client2, {
      serverId: locked.server_id,
      kind: "refund",
      purchaseId: locked.id,
      lines: [
        { account: locked.character_id, amount: -locked.coins },
        { account: "house", amount: locked.coins },
      ],
    });
    await client2.query("UPDATE coin_purchases SET state = 'refunded' WHERE id = $1", [purchaseId]);
    const character = await client2.query<{ name: string }>("SELECT name FROM characters WHERE id = $1", [locked.character_id]);
    const buyer = await client2.query<{ email: string; handle: string }>("SELECT email, handle FROM users WHERE id = $1", [locked.user_id]);
    const server = await client2.query<{ name: string; slug: string }>("SELECT name, slug FROM servers WHERE id = $1", [locked.server_id]);
    if (buyer.rows[0] !== undefined && character.rows[0] !== undefined && server.rows[0] !== undefined) {
      await client2.query(
        `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
         VALUES ($1,$2,'coin_refund',$3,$4,$5,$6,'held',$7)`,
        [
          newId(),
          locked.server_id,
          buyer.rows[0].handle,
          buyer.rows[0].email,
          `Coin purchase refunded on ${server.rows[0].name}`,
          `${locked.coins} coins were removed from ${character.rows[0].name} and ${locked.price} USD was refunded.`,
          `coin_refund:${locked.id}`,
        ]
      );
    }
    await client2.query("COMMIT");
    const after = await loadPurchase(pool, purchaseId);
    return after === null ? { ok: false, error: "unknown" } : { ok: true, purchase: after };
  } catch (err) {
    try {
      await client2.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client2.release();
  }
}

/** The receipt state of a purchase, read from its queued mail. */
export async function receiptState(pool: Pool, purchaseId: string): Promise<"sent" | "held"> {
  const res = await pool.query<{ state: string }>(
    "SELECT state FROM mail_outbox WHERE dedupe_key = $1 AND state = 'sent' LIMIT 1",
    [`coin_receipt:${purchaseId}`]
  );
  return res.rows.length > 0 ? "sent" : "held";
}

export function purchaseView(p: PurchaseRow, receipt: "sent" | "held"): {
  id: string;
  character_id: string;
  pack: string;
  coins: number;
  price: string;
  state: "pending" | "paid" | "refunded";
  receipt: "sent" | "held";
  created_at: string;
} {
  return {
    id: p.id,
    character_id: p.character_id,
    pack: p.pack,
    coins: p.coins,
    price: p.price,
    state: p.state,
    receipt,
    created_at: isoInstant(p.created_at),
  };
}
