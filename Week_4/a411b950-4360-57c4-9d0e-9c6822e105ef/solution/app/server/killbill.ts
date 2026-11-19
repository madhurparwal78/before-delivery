// Kill Bill REST client. Amounts go out as exact two-decimal strings and come back as cents parsed
// from the response's own decimal digits, never through a binary float.

import { config } from "./config.js";
import { fail } from "./http.js";
import { centsToDecimal, decimalToCents } from "../shared/money.js";

const { killbill } = config;
/** Kill Bill serves its REST API under /<version>/kb. */
const API_VERSION = "1.0";
const AUTO_PAY_OFF ="00000000-0000-0000-0000-000000000001";
const EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__";
const INVOICE_CONTROL = "__INVOICE_PAYMENT_CONTROL_PLUGIN__";
const AMOUNT_KEYS = new Set(["amount", "balance", "purchasedAmount", "processedAmount", "creditAdj", "refundAdj"]);

interface Account {
  accountId: string;
  paymentMethodId: string | null;
}

interface InvoiceItem {
  description: string | null;
  amountCents: number;
  startDate: string;
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amountCents: number;
  balanceCents: number;
  items: InvoiceItem[];
}

interface Transaction {
  transactionType: string;
  status: string;
  transactionExternalKey: string;
}

interface Payment {
  paymentId: string;
  transactions: Transaction[];
}

export function billingUnavailable(): never {
  fail(503, "billing_unavailable", "Billing is unreachable. Try again in a few minutes.");
}

/** Kill Bill refused or answered something unusable: logged, and reported as billing being unavailable. */
function refused(detail: string): never {
  console.error(`Kill Bill: ${detail}`);
  billingUnavailable();
}

/** JSON.parse that keeps the source digits of money fields as strings. */
function parseExact(text: string): unknown {
  return JSON.parse(text, (key, value: unknown, context?: { source?: string }) =>
    AMOUNT_KEYS.has(key) && typeof value === "number" && context?.source !== undefined ? context.source : value,
  );
}

function cents(value: unknown): number {
  const parsed = typeof value === "string" ? decimalToCents(value) : null;
  if (parsed === null) refused("an amount is not a decimal");
  return parsed;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown; location: string | null; label: string }> {
  let response: Response;
  try {
    response = await fetch(`${killbill.url}/${API_VERSION}/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${killbill.username}:${killbill.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": killbill.apiKey,
        "X-Killbill-ApiSecret": killbill.apiSecret,
        "X-Killbill-CreatedBy": "earshot",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    billingUnavailable();
  }
  const text = await response.text();
  if (response.status >= 500) billingUnavailable();
  return {
    status: response.status,
    data: text ? parseExact(text) : null,
    location: response.headers.get("location"),
    label: `${method} ${path.split("?")[0]}`,
  };
}

function expect(result: { status: number; data: unknown; label: string }, ...ok: number[]): unknown {
  if (!ok.includes(result.status)) refused(`${result.label} answered ${result.status}`);
  return result.data;
}

function toInvoice(raw: Record<string, unknown>): Invoice {
  const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
  return {
    invoiceId: String(raw.invoiceId),
    invoiceNumber: String(raw.invoiceNumber),
    status: String(raw.status),
    amountCents: cents(raw.amount),
    balanceCents: cents(raw.balance),
    items: items.map((item) => ({
      description: typeof item.description === "string" ? item.description : null,
      amountCents: cents(item.amount),
      startDate: typeof item.startDate === "string" ? item.startDate : "",
    })),
  };
}

async function findAccount(externalKey: string): Promise<Account | null> {
  const result = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (result.status === 404) return null;
  const raw = expect(result, 200) as Record<string, unknown>;
  return { accountId: String(raw.accountId), paymentMethodId: (raw.paymentMethodId as string | null) ?? null };
}

/**
 * Finds the account by external key or creates it (USD, the operator's time zone, invoices not auto-paid,
 * external payment method as default). A key taken by a concurrent creator is looked up again and reused;
 * an existing account keeps the time zone Kill Bill holds.
 */
export async function ensureAccount(
  details: { externalKey: string; name: string; email: string; company: string; timeZone: string },
): Promise<Account> {
  let account = await findAccount(details.externalKey);
  if (!account) {
    const created = await call("POST", "/accounts", { ...details, currency: "USD" });
    if (created.status !== 201 && created.status !== 409) refused(`account creation answered ${created.status}`);
    account = await findAccount(details.externalKey);
    if (!account) refused("account missing after creation");
  }
  const tags = expect(await call("GET", `/accounts/${account.accountId}/tags`), 200) as { tagDefinitionId: string }[];
  if (!tags.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF)) {
    expect(await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF]), 200, 201);
  }
  if (!account.paymentMethodId) {
    expect(await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PLUGIN }), 200, 201);
  }
  return account;
}

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  return toInvoice(expect(await call("GET", `/invoices/${invoiceId}?withItems=true`), 200) as Record<string, unknown>);
}

/** Every invoice on the account, with items. */
export async function accountInvoices(accountId: string): Promise<Invoice[]> {
  const list = expect(await call("GET", `/accounts/${accountId}/invoices`), 200) as Record<string, unknown>[];
  return Promise.all(list.map((raw) => getInvoice(String(raw.invoiceId))));
}

/** One external charge for exactly `amountCents` dated on the business date, committed as its own invoice. */
export async function createChargeInvoice(
  accountId: string, amountCents: number, description: string, businessDate: string,
): Promise<Invoice> {
  const items = expect(
    await call("POST", `/invoices/charges/${accountId}?autoCommit=true&requestedDate=${businessDate}`, [
      { accountId, amount: centsToDecimal(amountCents), currency: "USD", description, startDate: businessDate },
    ]),
    200,
    201,
  ) as { invoiceId: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) refused("charge returned no invoice");
  return getInvoice(invoiceId);
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  expect(await call("PUT", `/invoices/${invoiceId}/voidInvoice`), 204, 200);
}

/** The id of a successful PURCHASE on the account carrying the transaction external key, if any. */
export async function findPurchase(accountId: string, transactionExternalKey: string): Promise<string | null> {
  const payments = expect(await call("GET", `/accounts/${accountId}/payments`), 200) as Payment[];
  const found = payments.find((payment) =>
    payment.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS"
      && t.transactionExternalKey === transactionExternalKey));
  return found?.paymentId ?? null;
}

/** The first payment recorded against the invoice. */
export async function invoicePaymentId(invoiceId: string): Promise<string | null> {
  const payments = expect(await call("GET", `/invoices/${invoiceId}/payments`), 200) as { paymentId: string }[];
  return payments[0]?.paymentId ?? null;
}

/** Records one PURCHASE against the invoice for exactly `amountCents` and returns the payment id. */
export async function payInvoice(accountId: string, invoiceId: string, amountCents: number, transactionExternalKey: string): Promise<string> {
  const property = encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`);
  const result = await call(
    "POST",
    `/accounts/${accountId}/payments?controlPluginName=${INVOICE_CONTROL}&pluginProperty=${property}`,
    { transactionType: "PURCHASE", amount: centsToDecimal(amountCents), currency: "USD", transactionExternalKey },
  );
  expect(result, 200, 201);
  const paymentId = result.location?.match(/payments\/([0-9a-f-]{36})/)?.[1];
  if (!paymentId) refused("payment returned no id");
  return paymentId;
}
