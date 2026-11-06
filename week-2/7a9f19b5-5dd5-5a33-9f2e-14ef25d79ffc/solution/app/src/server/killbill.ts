// Kill Bill client. Every request carries the tenant headers and the admin credentials from config;
// a call that cannot connect, times out or gets a failed reply raises ProviderUnavailable.
import { config, PROVIDER_TIMEOUT_MS } from "./config.js";
import { pool } from "./db.js";
import { ProviderUnavailable } from "./errors.js";
import type { UserRow } from "./auth.js";

const CREATED_BY = "lightfall";
const CURRENCY = "NZD";
const EXTERNAL_PAYMENT_PLUGIN = "__EXTERNAL_PAYMENT__";
/** Kill Bill's built-in AUTO_PAY_OFF control tag: invoices wait for "Record payment" instead of auto-charging. */
const AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";

interface KbTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
}

interface KbPayment {
  paymentId: string;
  transactions: KbTransaction[];
}

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

interface InvoiceCharge {
  description: string;
  amountCents: number;
}

/** Kill Bill takes amounts in dollars; this is the only cents → dollars conversion for money that leaves the app. */
function toDollars(cents: number): number {
  return cents / 100;
}

async function call(method: string, path: string, body?: unknown, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": CREATED_BY,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderUnavailable("killbill", `${method} ${path.split("?")[0]} got no reply`);
  }
}

async function expect(response: Response, what: string, statuses: number[]): Promise<Response> {
  if (!statuses.includes(response.status)) {
    throw new ProviderUnavailable("killbill", `${what} answered ${response.status}`);
  }
  return response;
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderUnavailable("killbill", `${what} sent no JSON`);
  }
}

async function accountByKey(externalKey: string): Promise<KbAccount | null> {
  const response = await expect(
    await call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`),
    "account lookup",
    [200, 404],
  );
  return response.status === 404 ? null : readJson<KbAccount>(response, "account lookup");
}

async function prepareAccount(accountId: string): Promise<void> {
  await expect(
    await call("POST", `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      pluginName: EXTERNAL_PAYMENT_PLUGIN,
      pluginInfo: {},
    }),
    "payment method",
    [201],
  );
  await expect(await call("POST", `/1.0/kb/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]), "account tag", [201]);
}

/** The buyer's one Kill Bill account (external key `lf-user-<id>`), created on first need and reused after. */
async function ensureAccount(user: UserRow): Promise<string> {
  if (user.kb_account_id) return user.kb_account_id;
  const externalKey = `lf-user-${user.id}`;
  let account = await accountByKey(externalKey);
  if (!account) {
    const created = await call("POST", "/1.0/kb/accounts", {
      name: user.name,
      email: user.email,
      externalKey,
      currency: CURRENCY,
    });
    await expect(created, "account create", [201, 409]);
    account = await accountByKey(externalKey);
    if (!account) throw new ProviderUnavailable("killbill", "account missing after create");
  }
  if (!account.paymentMethodId) await prepareAccount(account.accountId);
  await pool.query("UPDATE users SET kb_account_id = $1 WHERE id = $2", [account.accountId, user.id]);
  return account.accountId;
}

async function paymentByKey(externalKey: string): Promise<KbPayment | null> {
  const response = await expect(
    await call("GET", `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`),
    "payment lookup",
    [200, 404],
  );
  return response.status === 404 ? null : readJson<KbPayment>(response, "payment lookup");
}

function successful(payment: KbPayment | null, type: string, transactionKey: string): KbTransaction | undefined {
  return payment?.transactions.find(
    (t) => t.transactionType === type && t.transactionExternalKey === transactionKey && t.status === "SUCCESS",
  );
}

/**
 * Authorises the order total under payment key `<orderKey>`. A successful authorisation already recorded
 * there (for example after a timeout) is adopted instead of creating another.
 */
export async function authorize(user: UserRow, orderKey: string, totalCents: number): Promise<string> {
  const transactionKey = `${orderKey}-auth`;
  const existing = await paymentByKey(orderKey);
  if (successful(existing, "AUTHORIZE", transactionKey)) return existing!.paymentId;
  const accountId = await ensureAccount(user);
  await expect(
    await call("POST", `/1.0/kb/accounts/${accountId}/payments`, {
      transactionType: "AUTHORIZE",
      amount: toDollars(totalCents),
      currency: CURRENCY,
      paymentExternalKey: orderKey,
      transactionExternalKey: transactionKey,
    }),
    "authorize",
    [201],
  );
  const payment = await paymentByKey(orderKey);
  if (!successful(payment, "AUTHORIZE", transactionKey)) throw new ProviderUnavailable("killbill", "authorize failed");
  return payment!.paymentId;
}

async function paymentTransaction(
  paymentId: string,
  orderKey: string,
  type: "CAPTURE" | "REFUND",
  transactionKey: string,
  amountCents: number,
): Promise<string> {
  const before = await paymentByKey(orderKey);
  const adopted = successful(before, type, transactionKey);
  if (adopted) return adopted.transactionId;
  const path = type === "CAPTURE" ? `/1.0/kb/payments/${paymentId}` : `/1.0/kb/payments/${paymentId}/refunds`;
  await expect(
    await call("POST", path, { amount: toDollars(amountCents), currency: CURRENCY, transactionExternalKey: transactionKey }),
    type.toLowerCase(),
    [201],
  );
  const done = successful(await paymentByKey(orderKey), type, transactionKey);
  if (!done) throw new ProviderUnavailable("killbill", `${type.toLowerCase()} failed`);
  return done.transactionId;
}

export function capture(paymentId: string, orderKey: string, amountCents: number): Promise<string> {
  return paymentTransaction(paymentId, orderKey, "CAPTURE", `${orderKey}-capture`, amountCents);
}

export function refund(paymentId: string, orderKey: string, sequence: number, amountCents: number): Promise<string> {
  return paymentTransaction(paymentId, orderKey, "REFUND", `${orderKey}-refund-${sequence}`, amountCents);
}

/** Raises one invoice of external charges, in one request. Returns the invoice id and number. */
export async function invoiceCharges(
  user: UserRow,
  charges: InvoiceCharge[],
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const accountId = await ensureAccount(user);
  const response = await expect(
    await call(
      "POST",
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
      charges.map((charge) => ({
        accountId,
        description: charge.description,
        amount: toDollars(charge.amountCents),
        currency: CURRENCY,
      })),
    ),
    "invoice charges",
    [200, 201],
  );
  const items = await readJson<{ invoiceId: string }[]>(response, "invoice charges");
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new ProviderUnavailable("killbill", "invoice charges returned no invoice");
  const invoice = await readJson<{ invoiceNumber: string | number }>(
    await expect(await call("GET", `/1.0/kb/invoices/${invoiceId}`), "invoice lookup", [200]),
    "invoice lookup",
  );
  return { invoiceId, invoiceNumber: String(invoice.invoiceNumber) };
}

/** Pays the invoice as an external payment under payment key `<orderKey>-payment`. */
export async function payInvoice(user: UserRow, invoiceId: string, orderKey: string, amountCents: number): Promise<void> {
  const paymentKey = `${orderKey}-payment`;
  const existing = await paymentByKey(paymentKey);
  if (existing?.transactions.some((t) => t.status === "SUCCESS")) return;
  const accountId = await ensureAccount(user);
  await expect(
    await call("POST", `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: toDollars(amountCents),
      currency: CURRENCY,
      paymentExternalKey: paymentKey,
    }),
    "invoice payment",
    [201],
  );
}

export async function healthy(timeoutMs: number): Promise<boolean> {
  try {
    return (await call("GET", "/1.0/healthcheck", undefined, timeoutMs)).ok;
  } catch {
    return false;
  }
}
