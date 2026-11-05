import { config } from "./config.js";
import { ApiError } from "./http.js";
import { fromDecimal, toDecimal } from "./money.js";

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_PAYMENT = "__EXTERNAL_PAYMENT__";
const INVOICE_CONTROL = "__INVOICE_PAYMENT_CONTROL_PLUGIN__";

interface KbTransaction {
  transactionType: string;
  transactionExternalKey: string;
  amount: number;
  status: string;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KbTransaction[];
}

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  description: string | null;
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, "billing_unavailable", "Billing is offline right now.");
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "opaline-bench-days",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw billingUnavailable();
  }
  if (response.status >= 500) throw billingUnavailable();
  return response;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await call(method, path, body);
  if (!response.ok) throw billingUnavailable();
  return (await response.json()) as T;
}

async function maybe<T>(path: string): Promise<T | null> {
  const response = await call("GET", path);
  if (response.status === 404) return null;
  if (!response.ok) throw billingUnavailable();
  return (await response.json()) as T;
}

async function accountByKey(externalKey: string): Promise<KbAccount | null> {
  return maybe<KbAccount>(`/accounts?externalKey=${encodeURIComponent(externalKey)}`);
}

/** The Kill Bill account external key of an app account. */
function accountKey(accountId: string): string {
  return `ob-${accountId}`;
}

/** The buyer's Kill Bill account, created with USD, no auto-pay and the external payment method. */
export async function ensureAccount(buyer: { id: string; name: string; email: string }): Promise<string> {
  const externalKey = accountKey(buyer.id);
  let account = await accountByKey(externalKey);
  if (!account) {
    await call("POST", "/accounts", { name: buyer.name, email: buyer.email, currency: "USD", externalKey });
    account = await accountByKey(externalKey);
    if (!account) throw billingUnavailable();
  }
  if (!account.paymentMethodId) {
    await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF]);
    const created = await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PAYMENT });
    if (!created.ok && created.status !== 409) throw billingUnavailable();
  }
  return account.accountId;
}

/** One invoice of external charges, one item per seat, in the order given. */
export async function createInvoice(
  accountId: string,
  items: readonly { amountCents: number; description: string }[],
): Promise<{ invoiceId: string; itemIds: string[] }> {
  const created = await json<KbInvoiceItem[]>(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    items.map((item) => ({ accountId, amount: toDecimal(item.amountCents), currency: "USD", description: item.description })),
  );
  const itemIds = items.map((item) => created.find((c) => c.description === item.description)?.invoiceItemId);
  const invoiceId = created[0]?.invoiceId;
  if (!invoiceId || itemIds.some((id) => id === undefined)) throw billingUnavailable();
  return { invoiceId, itemIds: itemIds.filter((id): id is string => id !== undefined) };
}

export async function paymentByKey(externalKey: string): Promise<KbPayment | null> {
  return maybe<KbPayment>(`/payments?externalKey=${encodeURIComponent(externalKey)}`);
}

export function succeeded(payment: KbPayment, type: "PURCHASE" | "REFUND", transactionKey: string): boolean {
  return payment.transactions.some(
    (t) => t.transactionType === type && t.transactionExternalKey === transactionKey && t.status === "SUCCESS",
  );
}

/** PURCHASE against the invoice; payment and transaction external keys are both `externalKey`. */
export async function purchase(accountId: string, invoiceId: string, amountCents: number, externalKey: string): Promise<KbPayment> {
  const query = `controlPluginName=${INVOICE_CONTROL}&pluginProperty=${encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`)}`;
  const response = await call("POST", `/accounts/${accountId}/payments?${query}`, {
    transactionType: "PURCHASE",
    amount: toDecimal(amountCents),
    currency: "USD",
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  });
  const payment = await paymentByKey(externalKey);
  if (!response.ok || !payment || !succeeded(payment, "PURCHASE", externalKey)) throw billingUnavailable();
  return payment;
}

/** REFUND with an invoice item adjustment on that seat's item. */
export async function refund(paymentId: string, amountCents: number, invoiceItemId: string, transactionKey: string): Promise<void> {
  const amount = toDecimal(amountCents);
  const response = await call("POST", `/invoicePayments/${paymentId}/refunds`, {
    amount,
    currency: "USD",
    isAdjusted: true,
    adjustments: [{ invoiceItemId, amount, currency: "USD" }],
    transactionExternalKey: transactionKey,
  });
  if (!response.ok) throw billingUnavailable();
}

/** Purchased and refunded cents per transaction external key, as Kill Bill records them for an account. */
export async function accountTransactions(appAccountId: string): Promise<Map<string, { type: string; cents: number }>> {
  const account = await accountByKey(accountKey(appAccountId));
  const found = new Map<string, { type: string; cents: number }>();
  if (!account) return found;
  const payments = await json<KbPayment[]>("GET", `/accounts/${account.accountId}/payments`);
  for (const payment of payments) {
    for (const t of payment.transactions) {
      if (t.status === "SUCCESS") found.set(t.transactionExternalKey, { type: t.transactionType, cents: fromDecimal(t.amount) });
    }
  }
  return found;
}

