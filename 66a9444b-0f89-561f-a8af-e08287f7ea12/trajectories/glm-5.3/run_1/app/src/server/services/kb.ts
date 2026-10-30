import type { PoolClient } from "pg";
import type { App } from "../http.js";
import { PaymentUnavailable } from "../killbill.js";

export interface KbAccountRef {
  externalKey: string;
  accountId: string;
}

// One Kill Bill account per buyer: kerf-user-<id> for a visitor,
// kerf-org-<id> for an organisation. Cached in Postgres.
export async function ensureKbAccount(app: App, client: PoolClient, kind: "user" | "org", id: string, name: string): Promise<KbAccountRef> {
  const externalKey = `${kind === "user" ? "kerf-user" : "kerf-org"}-${id}`;
  const existing = await client.query("select kb_account_id from kb_accounts where external_key = $1", [externalKey]);
  if (existing.rows.length > 0) {
    return { externalKey, accountId: String(existing.rows[0].kb_account_id) };
  }
  const accountId = await app.killbill.ensureAccount(externalKey, name);
  await app.killbill.ensurePaymentMethod(accountId);
  await client.query(
    `insert into kb_accounts (external_key, user_id, organisation_id, kb_account_id)
     values ($1,$2,$3,$4) on conflict (external_key) do nothing`,
    [externalKey, kind === "user" ? Number(id) : null, kind === "org" ? id : null, accountId],
  );
  return { externalKey, accountId };
}

export async function recordKbTransaction(
  client: PoolClient,
  transactionId: string,
  transactionType: string,
  amountCents: number,
  externalKey: string,
  orderRef: string | null,
  paymentId: string | null = null,
): Promise<void> {
  if (!transactionId) return;
  await client.query(
    `insert into kb_transactions (killbill_transaction_id, transaction_type, amount_cents, status, external_key, order_ref, payment_id)
     values ($1,$2,$3,'SUCCESS',$4,$5,$6)`,
    [transactionId, transactionType, amountCents, externalKey, orderRef, paymentId],
  );
}

export { PaymentUnavailable };
