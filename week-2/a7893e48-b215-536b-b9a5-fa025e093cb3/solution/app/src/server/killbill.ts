import { config } from "./config.js";
import { one, pool } from "./db.js";
import { ApiError } from "./http.js";
import { serviceStatus } from "./status.js";

interface KbTransaction { transactionType: string; status: string }
interface KbPayment { paymentId: string; transactions?: KbTransaction[] }
interface KbResult { status: number; data: unknown; location: string | null }

const authorization = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

const unavailable = (): ApiError => new ApiError(503, "billing_unavailable");

/** One Kill Bill call; an unreachable server or a 5xx is billing_unavailable. */
async function call(method: "GET" | "POST", path: string, body?: object): Promise<KbResult> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: authorization,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "hearthshift",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    serviceStatus.billing = "delayed";
    throw unavailable();
  }
  if (response.status >= 500) throw unavailable();
  serviceStatus.billing = "ok";
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as unknown) : null, location: response.headers.get("location") };
}

const idFromLocation = (location: string | null): string => location?.split("/").filter(Boolean).pop() ?? "";

/** Kill Bill takes dollars; the app keeps integer cents and converts only at this edge. */
const dollars = (cents: number): number => Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);

async function paymentByKey(externalKey: string): Promise<KbPayment | null> {
  const result = await call("GET", `/payments?externalKey=${encodeURIComponent(externalKey)}`);
  if (result.status === 404) return null;
  if (result.status !== 200) throw unavailable();
  return result.data as KbPayment;
}

/** The renter's account (external key hs-renter-<id>), created with an external payment method on first charge. */
async function accountFor(renterId: string): Promise<string> {
  const cached = await one<{ account_id: string | null; name: string; email: string }>(pool,
    "SELECT b.account_id, r.name, r.email FROM renters r LEFT JOIN billing_accounts b ON b.renter_id = r.id WHERE r.id = $1", [renterId]);
  if (!cached) throw new ApiError(404, "not_found");
  if (cached.account_id) return cached.account_id;
  const externalKey = `hs-renter-${renterId}`;
  let accountId: string;
  const existing = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (existing.status === 200) {
    accountId = (existing.data as { accountId: string }).accountId;
  } else {
    const created = await call("POST", "/accounts", { name: cached.name, email: cached.email, externalKey, currency: "USD" });
    if (created.status !== 201) throw unavailable();
    accountId = idFromLocation(created.location);
  }
  const account = await call("GET", `/accounts/${accountId}`);
  if (!(account.data as { paymentMethodId?: string | null } | null)?.paymentMethodId) {
    const method = await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: { properties: [] } });
    if (method.status !== 201) throw unavailable();
  }
  await pool.query("INSERT INTO billing_accounts (renter_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [renterId, accountId]);
  return accountId;
}

/** A PURCHASE under its payment external key; a repeat returns the existing payment, never a second one. */
export async function purchase(renterId: string, externalKey: string, cents: number): Promise<string> {
  const existing = await paymentByKey(externalKey);
  if (existing?.transactions?.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS")) return existing.paymentId;
  const accountId = await accountFor(renterId);
  const result = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "PURCHASE", amount: dollars(cents), currency: "USD",
    paymentExternalKey: externalKey, transactionExternalKey: `${externalKey}-purchase`,
  });
  if (result.status !== 201) throw unavailable();
  return idFromLocation(result.location);
}

/** A REFUND of the payment's full amount; a payment already refunded is left alone. */
export async function refund(paymentId: string, cents: number): Promise<void> {
  const payment = await call("GET", `/payments/${paymentId}`);
  if (payment.status !== 200) throw unavailable();
  if ((payment.data as KbPayment).transactions?.some((t) => t.transactionType === "REFUND" && t.status === "SUCCESS")) return;
  const result = await call("POST", `/payments/${paymentId}/refunds`, {
    transactionType: "REFUND", amount: dollars(cents), currency: "USD", transactionExternalKey: `${paymentId}-refund`,
  });
  if (result.status !== 201) throw unavailable();
}

/**
 * Health re-check used by the status probe: a cheap tenant-scoped read. Not /1.0/healthcheck, whose queue check in
 * Kill Bill 0.24 is not thread-safe; concurrent polls from several instances corrupt it and leave it failing.
 */
export async function billingReachable(): Promise<boolean> {
  const probe = "/accounts/pagination?offset=0&limit=1";
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb${probe}`, {
      headers: {
        Authorization: authorization,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
