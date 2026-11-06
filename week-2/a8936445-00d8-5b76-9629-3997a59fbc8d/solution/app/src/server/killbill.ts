// Kill Bill: one account per tenant business, holding every charge, credit and payment.
import { config } from "./config";
import { pool, one, withClient, lockKey } from "./db";
import { ProviderError } from "./errors";
import { request } from "./outbound";

const AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";

function headers(): Record<string, string> {
  const { username, password, apiKey, apiSecret } = config.killbill;
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "X-Killbill-ApiKey": apiKey,
    "X-Killbill-ApiSecret": apiSecret,
    "X-Killbill-CreatedBy": "stationkeeper",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await request("billing", `${config.killbill.url}/1.0/kb${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
  });
  const text = response.body.toString("utf8");
  return { status: response.status, json: text ? safeJson(text) : null };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function expect(status: number, accepted: number[], what: string): void {
  if (!accepted.includes(status)) throw new ProviderError("billing", `${what} answered ${status}`);
}

const amount = (cents: number): number => cents / 100;

/** The tenant's account, created the first time the tenant needs billing. */
export async function accountFor(tenant: { id: string; business_name: string; owner_email: string }): Promise<string> {
  const known = await one<{ killbill_account_id: string | null }>(pool, "SELECT killbill_account_id FROM tenants WHERE id = $1", [tenant.id]);
  if (known?.killbill_account_id) return known.killbill_account_id;
  return withClient(async (db) => {
    const key = lockKey("killbill-account", tenant.id);
    await db.query("SELECT pg_advisory_lock($1::bigint)", [key]);
    try {
      const again = await one<{ killbill_account_id: string | null }>(db, "SELECT killbill_account_id FROM tenants WHERE id = $1", [tenant.id]);
      if (again?.killbill_account_id) return again.killbill_account_id;
      const accountId = await findOrCreateAccount(tenant);
      await db.query("UPDATE tenants SET killbill_account_id = $2 WHERE id = $1", [tenant.id, accountId]);
      return accountId;
    } finally {
      await db.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
    }
  });
}

async function findOrCreateAccount(tenant: { id: string; business_name: string; owner_email: string }): Promise<string> {
  const query = `/accounts?externalKey=${encodeURIComponent(tenant.id)}`;
  let found = await call("GET", query);
  if (found.status === 404) {
    const created = await call("POST", "/accounts", {
      name: tenant.business_name,
      externalKey: tenant.id,
      currency: "USD",
      email: tenant.owner_email,
    });
    expect(created.status, [201], "account creation");
    found = await call("GET", query);
  }
  expect(found.status, [200], "account lookup");
  const accountId = (found.json as { accountId: string }).accountId;
  const tags = await call("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  expect(tags.status, [201, 409], "automatic payment off");
  const methods = await call("GET", `/accounts/${accountId}/paymentMethods`);
  expect(methods.status, [200], "payment method lookup");
  if ((methods.json as unknown[]).length === 0) {
    const method = await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" });
    expect(method.status, [201], "payment method creation");
  }
  return accountId;
}

export type BillingRecord = "charge" | "credit";

/** An external charge or a credit of `cents` with `description` on the account. */
export async function record(accountId: string, kind: BillingRecord, cents: number, description: string): Promise<void> {
  const item = { accountId, amount: amount(cents), currency: "USD", description, itemType: kind === "charge" ? "EXTERNAL_CHARGE" : "CREDIT_ADJ" };
  const path = kind === "charge" ? `/invoices/charges/${accountId}?autoCommit=true` : "/credits?autoCommit=true";
  const response = await call("POST", path, [item]);
  expect(response.status, [200, 201], `${kind} ${description}`);
}

/** A PURCHASE payment whose transaction external key makes it exactly-once. */
export async function purchase(accountId: string, cents: number, externalKey: string): Promise<void> {
  const response = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "PURCHASE",
    amount: amount(cents),
    currency: "USD",
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  });
  if (response.status === 201) return;
  // A repeated key is refused; the payment already recorded under it counts once.
  const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(externalKey)}`);
  const transactions = (existing.json as { transactions?: { status: string }[] } | null)?.transactions ?? [];
  if (existing.status === 200 && transactions.some((t) => t.status === "SUCCESS")) return;
  throw new ProviderError("billing", `payment ${externalKey} answered ${response.status}`);
}
