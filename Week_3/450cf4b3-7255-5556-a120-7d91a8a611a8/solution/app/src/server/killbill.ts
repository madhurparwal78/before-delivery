// Kill Bill REST calls for hour packs. Any network failure or non-2xx answer is BillingUnavailable.

import { dollars } from "../shared/format.js";
import { config } from "./config.js";

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__";
const TIMEOUT_MS = 20_000;

export class BillingUnavailable extends Error {}

interface Answer {
  status: number;
  location: string;
  body: unknown;
}

/** GETs are safe to repeat, so a slow or dropped one is tried once more before billing counts as down. */
async function call(method: string, path: string, body?: unknown, allow: readonly number[] = []): Promise<Answer> {
  try {
    return await attempt(method, path, body, allow);
  } catch (error) {
    if (method !== "GET" || !(error instanceof BillingUnavailable)) throw error;
    return attempt(method, path, body, allow);
  }
}

async function attempt(method: string, path: string, body: unknown, allow: readonly number[]): Promise<Answer> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "stationhouse",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new BillingUnavailable(`Kill Bill ${method} ${path} unreachable: ${String(error)}`);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok && !allow.includes(response.status)) {
    throw new BillingUnavailable(`Kill Bill ${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`);
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, location: response.headers.get("location") ?? "", body: parsed };
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

function idFromLocation(location: string): string {
  const id = location.split("/").filter(Boolean).pop();
  if (!id) throw new BillingUnavailable("Kill Bill answered without a Location");
  return id;
}

function amount(cents: number): number {
  return Number(dollars(cents));
}

export async function findAccount(externalKey: string): Promise<string | null> {
  const answer = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, [404]);
  const id = field(answer.body, "accountId");
  return answer.status === 200 && typeof id === "string" ? id : null;
}

/** The tenant's account (external key stationhouse-<tenantId>), USD, external default payment method, auto-pay off. */
export async function ensureAccount(tenantId: string, name: string, email: string): Promise<string> {
  const externalKey = `stationhouse-${tenantId}`;
  let accountId = await findAccount(externalKey);
  if (!accountId) {
    const created = await call("POST", "/accounts", { name, email, currency: "USD", externalKey }, [409]);
    accountId = created.status === 409 ? await findAccount(externalKey) : idFromLocation(created.location);
    if (!accountId) throw new BillingUnavailable("Kill Bill account could not be created");
  }
  const methods = await call("GET", `/accounts/${accountId}/paymentMethods`);
  if (!Array.isArray(methods.body) || methods.body.length === 0) {
    await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PLUGIN });
  }
  const tags = await call("GET", `/accounts/${accountId}/tags`);
  if (!Array.isArray(tags.body) || !tags.body.some((tag) => field(tag, "tagDefinitionId") === AUTO_PAY_OFF)) {
    await call("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]);
  }
  return accountId;
}

/** One committed invoice holding one external charge item. */
export async function chargeInvoice(accountId: string, description: string, cents: number): Promise<{ invoiceId: string; itemId: string }> {
  const answer = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, [
    { accountId, description, amount: amount(cents), currency: "USD" },
  ]);
  const item: unknown = Array.isArray(answer.body) ? answer.body[0] : undefined;
  const invoiceId = field(item, "invoiceId");
  const itemId = field(item, "invoiceItemId");
  if (typeof invoiceId !== "string" || typeof itemId !== "string") throw new BillingUnavailable("Kill Bill returned no invoice");
  return { invoiceId, itemId };
}

/** One PURCHASE payment against the external payment method, carrying the attempt's external key. */
export async function payInvoice(accountId: string, invoiceId: string, cents: number, externalKey: string): Promise<string> {
  const answer = await call("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId, targetInvoiceId: invoiceId, purchasedAmount: amount(cents), paymentExternalKey: externalKey,
  });
  return idFromLocation(answer.location);
}

/** The successful PURCHASE payment made under an external key, if any. */
export async function paidPayment(externalKey: string): Promise<string | null> {
  const answer = await call("GET", `/payments?externalKey=${encodeURIComponent(externalKey)}`, undefined, [404]);
  if (answer.status === 404) return null;
  const transactions = field(answer.body, "transactions");
  const paid = Array.isArray(transactions)
    && transactions.some((t) => field(t, "transactionType") === "PURCHASE" && field(t, "status") === "SUCCESS");
  const id = field(answer.body, "paymentId");
  return paid && typeof id === "string" ? id : null;
}

export async function unpaidInvoices(accountId: string): Promise<string[]> {
  const answer = await call("GET", `/accounts/${accountId}/invoices?unpaidInvoicesOnly=true`);
  if (!Array.isArray(answer.body)) return [];
  return answer.body.map((invoice: unknown) => field(invoice, "invoiceId")).filter((id): id is string => typeof id === "string");
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

/**
 * One REFUND on the pack's PURCHASE payment under the pack's refund key, adjusting the invoice item
 * so the account balance stays at zero. A refund already recorded under that key is not repeated.
 */
export async function refundPayment(paymentId: string, invoiceItemId: string, cents: number, refundKey: string): Promise<void> {
  const payment = await call("GET", `/payments/${paymentId}`);
  const transactions = field(payment.body, "transactions");
  const done = Array.isArray(transactions) && transactions.some((t) =>
    field(t, "transactionType") === "REFUND" && field(t, "transactionExternalKey") === refundKey && field(t, "status") === "SUCCESS");
  if (done) return;
  await call("POST", `/invoicePayments/${paymentId}/refunds`, {
    amount: amount(cents), currency: "USD", isAdjusted: true, transactionExternalKey: refundKey,
    adjustments: [{ invoiceItemId, amount: amount(cents), currency: "USD" }],
  });
}
