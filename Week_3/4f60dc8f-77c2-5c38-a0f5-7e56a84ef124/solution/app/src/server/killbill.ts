// Kill Bill: one account per brand, external-charge invoices, PURCHASE payments, REFUNDs, voids and blocking states.
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { toMajorString, type Currency } from "../shared/money.js";

const BASE = `${config.killbill.url}/1.0/kb`;
const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;
const BLOCKING_SERVICE = "gloamwork-billing";
// Kill Bill's AUTO_PAY_OFF control tag: invoices are paid only by the client's card payments, never automatically.
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";

type KbResponse = { status: number; json: unknown; location: string | null };

async function kb(method: string, path: string, body?: unknown): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: AUTH,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "gloamwork-shot-rig",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError("billing_unavailable");
  }
  const text = await response.text();
  if (response.status >= 500 || response.status === 401 || response.status === 403) throw new ApiError("billing_unavailable");
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null, location: response.headers.get("location") };
}

async function kbOk(method: string, path: string, body?: unknown): Promise<KbResponse> {
  const response = await kb(method, path, body);
  if (response.status >= 400) throw new ApiError("billing_unavailable");
  return response;
}

type KbAccount = { accountId: string };
type KbItem = { invoiceItemId: string; invoiceId: string; description: string; amount: number };
type KbInvoice = { invoiceId: string; invoiceNumber: string; balance: number; status: string; items: KbItem[] };
type KbTransaction = { transactionType: string; status: string; amount: number; transactionExternalKey: string };
type KbPayment = { paymentId: string; transactions: KbTransaction[] };

async function findAccount(brandId: string): Promise<string | null> {
  const response = await kb("GET", `/accounts?externalKey=${encodeURIComponent(brandId)}`);
  if (response.status === 404) return null;
  if (response.status >= 400) throw new ApiError("billing_unavailable");
  return (response.json as KbAccount).accountId;
}

/** The brand's account (external key = brand id), AUTO_PAY_OFF, with the external payment method as its default. */
export async function ensureAccount(brand: { id: string; name: string; currency: Currency }, financeEmail: string): Promise<string> {
  const existing = await findAccount(brand.id);
  if (existing) return existing;
  const created = await kb("POST", "/accounts", { name: brand.name, email: financeEmail, currency: brand.currency, externalKey: brand.id });
  if (created.status >= 400 && created.status !== 409) throw new ApiError("billing_unavailable");
  const accountId = await findAccount(brand.id);
  if (!accountId) throw new ApiError("billing_unavailable");
  const tags = (await kbOk("GET", `/accounts/${accountId}/tags`)).json as { tagDefinitionId: string }[];
  if (!tags.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF)) await kbOk("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]);
  const methods = await kbOk("GET", `/accounts/${accountId}/paymentMethods`);
  if ((methods.json as unknown[]).length === 0) {
    await kbOk("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" });
  }
  return accountId;
}

/** One committed invoice of external charges, one item per line, amounts in major units by the exponent rule. */
export async function createChargeInvoice(accountId: string, currency: Currency, lines: { description: string; amount_minor: number }[]): Promise<string> {
  const response = await kbOk(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    lines.map((line) => ({ accountId, description: line.description, amount: toMajorString(line.amount_minor, currency), currency })),
  );
  const items = response.json as KbItem[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId || items.some((item) => item.invoiceId !== invoiceId)) throw new ApiError("billing_unavailable");
  return invoiceId;
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  return (await kbOk("GET", `/invoices/${invoiceId}?withItems=true`)).json as KbInvoice;
}

export async function accountInvoices(accountId: string): Promise<KbInvoice[]> {
  return (await kbOk("GET", `/accounts/${accountId}/invoices?withItems=true&includeVoidedInvoices=true`)).json as KbInvoice[];
}

/** A PURCHASE for the invoice's balance through the account's default (external) payment method. */
export async function payInvoice(accountId: string, invoiceId: string, currency: Currency, amountMinor: number): Promise<string> {
  await kbOk("POST", `/invoices/${invoiceId}/payments?externalPayment=false`, {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: toMajorString(amountMinor, currency),
  });
  const payments = (await kbOk("GET", `/invoices/${invoiceId}/payments`)).json as KbPayment[];
  const paid = payments.filter((p) => p.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS"));
  const latest = paid.at(-1);
  if (!latest) throw new ApiError("billing_unavailable");
  return latest.paymentId;
}

export async function paymentTransactions(paymentId: string): Promise<KbTransaction[]> {
  return ((await kbOk("GET", `/payments/${paymentId}`)).json as KbPayment).transactions;
}

/** One REFUND transaction on a payment; `adjustItemId` also adjusts that invoice item so the invoice owes nothing. */
export async function refundPayment(
  paymentId: string,
  currency: Currency,
  amountMinor: number,
  transactionExternalKey: string,
  adjustItemId?: string,
): Promise<void> {
  const amount = toMajorString(amountMinor, currency);
  await kbOk("POST", `/invoicePayments/${paymentId}/refunds`, {
    paymentId,
    amount,
    transactionExternalKey,
    isAdjusted: adjustItemId !== undefined,
    ...(adjustItemId === undefined ? {} : { adjustments: [{ invoiceItemId: adjustItemId, amount, currency }] }),
  });
  const confirmed = (await paymentTransactions(paymentId)).some(
    (t) => t.transactionType === "REFUND" && t.status === "SUCCESS" && t.transactionExternalKey === transactionExternalKey,
  );
  if (!confirmed) throw new ApiError("billing_unavailable");
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await kbOk("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

export async function setOverdueBlock(accountId: string, blocked: boolean): Promise<void> {
  await kbOk("POST", `/accounts/${accountId}/block`, {
    stateName: blocked ? "OVERDUE" : "CLEAR",
    service: BLOCKING_SERVICE,
    isBlockChange: false,
    isBlockEntitlement: false,
    isBlockBilling: false,
  });
}

export async function billingReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}
