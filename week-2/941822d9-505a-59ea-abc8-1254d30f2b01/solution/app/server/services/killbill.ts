import { config } from "../config.js";
import { db, one, withLock } from "../db.js";
import { paymentsUnavailable } from "../http/errors.js";
import { formatMoney } from "../domain/amounts.js";

// Kill Bill REST client. Every write names the acting Credwell user, so Kill Bill's audit log attributes it.

const TIMEOUT_MS = 8000;

interface KillBillWrite {
  actor: string;
  reason?: string;
  comment?: string;
}

async function call(method: "GET" | "POST", path: string, write: KillBillWrite | null, body?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (write) {
    headers["X-Killbill-CreatedBy"] = `credwell:${write.actor}`;
    if (write.reason) headers["X-Killbill-Reason"] = write.reason;
    if (write.comment) headers["X-Killbill-Comment"] = write.comment;
  }
  try {
    return await fetch(`${config.killbill.url}/1.0/kb${path}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.error(`kill bill ${method} ${path} unreachable:`, error instanceof Error ? error.message : String(error));
    throw paymentsUnavailable();
  }
}

async function expect(response: Response, ok: number[], what: string): Promise<void> {
  if (ok.includes(response.status)) return;
  console.error(`kill bill ${what} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  throw paymentsUnavailable();
}

const idFromLocation = (response: Response): string | null => response.headers.get("location")?.split("/").pop() ?? null;

const field = (value: unknown, name: string): unknown =>
  value !== null && typeof value === "object" && name in value ? (value as Record<string, unknown>)[name] : undefined;

interface PayerAccount {
  externalKey: string;
  name: string;
  email: string | null;
}

/** The Kill Bill account for a payer, created on first use in USD with the external payment method as default. */
export async function payerAccountId(payer: PayerAccount, actor: string): Promise<string> {
  const known = await one<{ account_id: string }>(db, "SELECT account_id FROM payer_accounts WHERE external_key = $1", [payer.externalKey]);
  if (known) return known.account_id;
  return withLock(`killbill-account:${payer.externalKey}`, async () => {
    const cached = await one<{ account_id: string }>(db, "SELECT account_id FROM payer_accounts WHERE external_key = $1", [payer.externalKey]);
    if (cached) return cached.account_id;
    const lookup = await call("GET", `/accounts?externalKey=${encodeURIComponent(payer.externalKey)}`, null);
    let accountId: string | null = null;
    let hasMethod = false;
    if (lookup.status === 200) {
      const account: unknown = await lookup.json();
      accountId = String(field(account, "accountId"));
      hasMethod = typeof field(account, "paymentMethodId") === "string";
    } else {
      await expect(lookup, [404], "account lookup");
      const created = await call(
        "POST",
        "/accounts",
        { actor },
        JSON.stringify({ name: payer.name, email: payer.email ?? undefined, externalKey: payer.externalKey, currency: "USD" }),
      );
      await expect(created, [201], "account creation");
      accountId = idFromLocation(created);
    }
    if (accountId === null) throw paymentsUnavailable();
    if (!hasMethod) {
      const method = await call(
        "POST",
        `/accounts/${accountId}/paymentMethods?isDefault=true`,
        { actor },
        JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} }),
      );
      await expect(method, [201], "payment method creation");
    }
    await db.q("INSERT INTO payer_accounts (external_key, account_id) VALUES ($1, $2) ON CONFLICT (external_key) DO NOTHING", [payer.externalKey, accountId]);
    return accountId;
  });
}

/** Records one PURCHASE on the payer's account; amounts go to Kill Bill as exact decimal literals. */
export async function purchase(accountId: string, paymentExternalKey: string, cents: number, actor: string): Promise<void> {
  const body = `{"transactionType":"PURCHASE","amount":${formatMoney(cents)},"currency":"USD","paymentExternalKey":${JSON.stringify(paymentExternalKey)}}`;
  const response = await call("POST", `/accounts/${accountId}/payments`, { actor }, body);
  await expect(response, [201], `purchase ${paymentExternalKey}`);
}

/**
 * Records one REFUND on the original payment unless a transaction with this external key already exists,
 * so a retried approval or rollback never refunds twice.
 */
export async function refundOnce(paymentExternalKey: string, transactionExternalKey: string, cents: number, write: KillBillWrite): Promise<void> {
  const lookup = await call("GET", `/payments?externalKey=${encodeURIComponent(paymentExternalKey)}&withPluginInfo=false`, null);
  await expect(lookup, [200], `payment lookup ${paymentExternalKey}`);
  const payment: unknown = await lookup.json();
  const transactions = field(payment, "transactions");
  const done = Array.isArray(transactions) && transactions.some((t: unknown) => field(t, "transactionExternalKey") === transactionExternalKey);
  if (done) return;
  const body = `{"amount":${formatMoney(cents)},"currency":"USD","transactionExternalKey":${JSON.stringify(transactionExternalKey)}}`;
  const response = await call("POST", `/payments/${String(field(payment, "paymentId"))}/refunds`, write, body);
  await expect(response, [201], `refund ${transactionExternalKey}`);
}
