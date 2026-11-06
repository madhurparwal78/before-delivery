/**
 * Kill Bill client. Card authorisation, capture, refunds, trade invoices and
 * trade payments. Order states are written only after a successful reply here.
 */

import { loadConfig } from "../config.js";
import { centsToDollars, dollarsToCents } from "../../shared/money.js";
import type { IsoDate } from "../../shared/dates.js";
import { expectOk, parseJson, providerFetch, ProviderUnavailable, type ProviderResponse } from "./provider.js";

const config = loadConfig();
const BASE = `${config.killbill.url}/1.0/kb`;
const CURRENCY = "NZD";
const EXTERNAL_PAYMENT_PLUGIN = "__EXTERNAL_PAYMENT__";

/**
 * Kill Bill pays a committed invoice automatically when the account has a default
 * payment method. Account orders must stay unpaid until an admin records the
 * payment, so every account carries the AUTO_PAY_OFF control tag.
 */
const AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";

function headers(extra?: Record<string, string>): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  return {
    authorization: `Basic ${basic}`,
    "x-killbill-apikey": config.killbill.apiKey,
    "x-killbill-apisecret": config.killbill.apiSecret,
    "x-killbill-createdby": "lightfall",
    accept: "application/json",
    ...extra,
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  allowed: readonly number[] = [200, 201, 204],
): Promise<ProviderResponse> {
  const response = await providerFetch("killbill", `${BASE}${path}`, {
    method,
    headers: body === undefined ? headers() : headers({ "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expectOk("killbill", response, allowed);
  return response;
}

function idFromLocation(response: ProviderResponse, what: string): string {
  const location = response.headers.get("location");
  const id = location?.replace(/\/+$/, "").split("/").pop();
  if (!id) throw new ProviderUnavailable("killbill", new Error(`Kill Bill gave no ${what} id`));
  return id;
}

interface KbTransaction {
  transactionId: string;
  transactionType: string;
  status: string;
  amount: number;
  transactionExternalKey: string;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  authAmount: number;
  capturedAmount: number;
  refundedAmount: number;
  transactions: KbTransaction[];
}

interface KbAccount {
  accountId: string;
}

interface KbInvoiceItem {
  invoiceId: string;
}

interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
}

/** One Kill Bill account per buyer, external key `lf-user-<user id>`, created on first need. */
export async function ensureAccount(args: { userId: string; name: string }): Promise<string> {
  const externalKey = `lf-user-${args.userId}`;
  const lookup = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, [200, 404]);
  if (lookup.status === 200) return parseJson<KbAccount>("killbill", lookup).accountId;

  const created = await call("POST", "/accounts", { externalKey, name: args.name, currency: CURRENCY }, [201]);
  const accountId = idFromLocation(created, "account");
  await call("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG], [201]);
  await call(
    "POST",
    `/accounts/${accountId}/paymentMethods?isDefault=true`,
    { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
    [201],
  );
  return accountId;
}

/** Looks a payment up by the order key, so a timed-out authorisation can be adopted. */
export async function findPaymentByOrderKey(orderKey: string): Promise<KbPayment | null> {
  const response = await call("GET", `/payments?externalKey=${encodeURIComponent(orderKey)}`, undefined, [200, 404]);
  if (response.status === 404) return null;
  return parseJson<KbPayment>("killbill", response);
}

function successful(payment: KbPayment, type: string): KbTransaction | null {
  return payment.transactions.find((t) => t.transactionType === type && t.status === "SUCCESS") ?? null;
}

export interface AuthorisationResult {
  kb_payment_id: string;
  authorised_cents: number;
}

/**
 * One payment per card order, keyed by the order key, with one AUTHORIZE
 * transaction for the order total. An authorisation already recorded against the
 * order key is adopted rather than repeated.
 */
export async function authorise(args: {
  accountId: string;
  orderKey: string;
  totalCents: number;
}): Promise<AuthorisationResult> {
  const existing = await findPaymentByOrderKey(args.orderKey);
  const existingAuth = existing ? successful(existing, "AUTHORIZE") : null;
  if (existing && existingAuth) {
    return { kb_payment_id: existing.paymentId, authorised_cents: dollarsToCents(existingAuth.amount) };
  }

  const created = await call(
    "POST",
    `/accounts/${args.accountId}/payments`,
    {
      transactionType: "AUTHORIZE",
      amount: centsToDollars(args.totalCents),
      currency: CURRENCY,
      paymentExternalKey: args.orderKey,
      transactionExternalKey: `${args.orderKey}-auth`,
    },
    [201],
  );
  return { kb_payment_id: idFromLocation(created, "payment"), authorised_cents: args.totalCents };
}

/** Dispatch captures the full authorised amount, at most once per order. */
export async function capture(args: { paymentId: string; orderKey: string; totalCents: number }): Promise<void> {
  const existing = await findPaymentByOrderKey(args.orderKey);
  if (existing && successful(existing, "CAPTURE")) return;

  await call(
    "POST",
    `/payments/${args.paymentId}`,
    {
      transactionType: "CAPTURE",
      amount: centsToDollars(args.totalCents),
      currency: CURRENCY,
      transactionExternalKey: `${args.orderKey}-capture`,
    },
    [201],
  );

  const after = await findPaymentByOrderKey(args.orderKey);
  if (!after || !successful(after, "CAPTURE")) {
    throw new ProviderUnavailable("killbill", new Error("Kill Bill did not record the capture"));
  }
}

/**
 * Each refund is a REFUND transaction keyed `<orderKey>-refund-<n>`. Kill Bill
 * records refunds on the payment's `/refunds` sub-resource; posting a REFUND
 * transaction type to the payment itself is recorded as another capture.
 */
export async function refund(args: {
  paymentId: string;
  orderKey: string;
  seq: number;
  amountCents: number;
}): Promise<{ kb_transaction_id: string }> {
  const transactionExternalKey = `${args.orderKey}-refund-${args.seq}`;
  await call(
    "POST",
    `/payments/${args.paymentId}/refunds`,
    { amount: centsToDollars(args.amountCents), currency: CURRENCY, transactionExternalKey },
    [201],
  );

  const after = await findPaymentByOrderKey(args.orderKey);
  const recorded = after?.transactions.find(
    (t) => t.transactionExternalKey === transactionExternalKey && t.status === "SUCCESS",
  );
  if (!recorded) throw new ProviderUnavailable("killbill", new Error("Kill Bill did not record the refund"));
  return { kb_transaction_id: recorded.transactionId };
}

export interface InvoiceResult {
  kb_invoice_id: string;
  invoice_number: string;
  invoice_date: IsoDate;
}

/**
 * One invoice per dispatched account order, made of external charges in one
 * request: one item per order line without GST, plus one GST item.
 */
export async function createInvoice(args: {
  accountId: string;
  items: ReadonlyArray<{ description: string; amountCents: number }>;
}): Promise<InvoiceResult> {
  const charges = args.items.map((item) => ({
    accountId: args.accountId,
    currency: CURRENCY,
    amount: centsToDollars(item.amountCents),
    description: item.description,
  }));

  const created = await call("POST", `/invoices/charges/${args.accountId}?autoCommit=true`, charges, [200, 201]);
  const items = parseJson<KbInvoiceItem[]>("killbill", created);
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new ProviderUnavailable("killbill", new Error("Kill Bill raised no invoice"));

  const invoice = parseJson<KbInvoice>("killbill", await call("GET", `/invoices/${invoiceId}`, undefined, [200]));
  return {
    kb_invoice_id: invoice.invoiceId,
    invoice_number: String(invoice.invoiceNumber),
    invoice_date: invoice.invoiceDate,
  };
}

/** Records full payment of an account invoice as an external payment. */
export async function payInvoice(args: {
  accountId: string;
  invoiceId: string;
  orderKey: string;
  amountCents: number;
}): Promise<void> {
  await call(
    "POST",
    `/invoices/${args.invoiceId}/payments?externalPayment=true`,
    {
      accountId: args.accountId,
      targetInvoiceId: args.invoiceId,
      purchasedAmount: centsToDollars(args.amountCents),
      currency: CURRENCY,
      paymentExternalKey: `${args.orderKey}-payment`,
    },
    [201, 204],
  );

  const invoice = parseJson<KbInvoice>(
    "killbill",
    await call("GET", `/invoices/${args.invoiceId}`, undefined, [200]),
  );
  if (dollarsToCents(invoice.balance) > 0) {
    throw new ProviderUnavailable("killbill", new Error("Kill Bill left the invoice unpaid"));
  }
}

export async function ping(timeoutMs: number): Promise<void> {
  const response = await providerFetch("killbill", `${config.killbill.url}/1.0/healthcheck`, { timeoutMs });
  expectOk("killbill", response, [200]);
}
