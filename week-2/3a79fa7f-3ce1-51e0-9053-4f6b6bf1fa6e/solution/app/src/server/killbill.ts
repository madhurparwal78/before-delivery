// Kill Bill (brief: Kill Bill): one account per customer by externalKey, one itemised external-charge invoice
// per order, one item adjustment per item on cancellation. Every write names its reason and the order number.
import { config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { decimalDollars } from "./money.ts";

const TIMEOUT_MS = 15_000;

export class BillingUnavailable extends Error {}

/** Why a write happens; it becomes X-Killbill-Reason, and the order number X-Killbill-Comment. */
type Reason = "order_placed" | "order_cancelled";
interface Write {
  reason: Reason;
  number: string;
}

async function call(method: "GET" | "POST", path: string, write?: Write & { body: string }): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "X-Killbill-ApiKey": apiKey,
    "X-Killbill-ApiSecret": apiSecret,
    Accept: "application/json",
  };
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["X-Killbill-CreatedBy"] = "tern-foils";
    headers["X-Killbill-Reason"] = write.reason;
    headers["X-Killbill-Comment"] = write.number;
  }
  try {
    return await fetch(`${url}${path}`, { method, headers, body: write?.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new BillingUnavailable();
  }
}

async function accountId(externalKey: string): Promise<string | null> {
  const res = await call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new BillingUnavailable();
  const account = (await res.json()) as { accountId: string };
  return account.accountId;
}

export function billingKey(email: string): string {
  return `tern-${email.toLowerCase()}`;
}

/** Makes sure the customer's one account exists; a 409 for a used externalKey counts as existing. */
export async function ensureAccount(input: { email: string; name: string; country: string; number: string }): Promise<string> {
  const key = billingKey(input.email);
  const existing = await accountId(key);
  if (existing) return existing;
  const res = await call("POST", "/1.0/kb/accounts", {
    reason: "order_placed",
    number: input.number,
    body: JSON.stringify({ name: input.name, email: input.email, externalKey: key, currency: "USD", country: input.country }),
  });
  if (!res.ok && res.status !== 409) throw new BillingUnavailable();
  const created = await accountId(key);
  if (!created) throw new BillingUnavailable();
  return created;
}

export interface ChargeItem {
  description: string;
  cents: number;
}

export interface Invoice {
  invoiceId: string;
  items: { invoiceItemId: string; description: string; cents: number }[];
}

/** One charge call carrying every item, all on one invoice. */
export async function charge(account: string, number: string, items: ChargeItem[]): Promise<Invoice> {
  const body = `[${items
    .map((i) => `{"accountId":${JSON.stringify(account)},"amount":${decimalDollars(i.cents)},"currency":"USD","description":${JSON.stringify(i.description)}}`)
    .join(",")}]`;
  const res = await call("POST", `/1.0/kb/invoices/charges/${encodeURIComponent(account)}?autoCommit=true`, { reason: "order_placed", number, body });
  if (!res.ok) throw new BillingUnavailable();
  const created = (await res.json()) as { invoiceId: string; invoiceItemId: string; description: string }[];
  const invoiceId = created[0]?.invoiceId;
  if (!invoiceId) throw new BillingUnavailable();
  return {
    invoiceId,
    items: created.map((c) => ({ invoiceItemId: c.invoiceItemId, description: c.description, cents: items.find((i) => i.description === c.description)!.cents })),
  };
}

/** Item ids of the invoice that already carry an item adjustment, read from Kill Bill. */
async function adjustedItems(invoiceId: string): Promise<Set<string>> {
  const res = await call("GET", `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}?withChildrenItems=false`);
  if (!res.ok) throw new BillingUnavailable();
  const invoice = (await res.json()) as { items?: { itemType: string; linkedInvoiceItemId?: string | null }[] };
  return new Set((invoice.items ?? []).filter((i) => i.itemType === "ITEM_ADJ" && i.linkedInvoiceItemId).map((i) => i.linkedInvoiceItemId as string));
}

/** Adjusts every item not yet adjusted by its full amount, one adjustment per item. */
export async function adjustToZero(account: string, invoice: Invoice, write: Write): Promise<void> {
  const done = await adjustedItems(invoice.invoiceId);
  for (const item of invoice.items.filter((i) => !done.has(i.invoiceItemId))) {
    const body = JSON.stringify({
      accountId: account, invoiceId: invoice.invoiceId, invoiceItemId: item.invoiceItemId, currency: "USD", description: item.description,
    }).replace(/}$/, `,"amount":${decimalDollars(item.cents)}}`);
    const res = await call("POST", `/1.0/kb/invoices/${encodeURIComponent(invoice.invoiceId)}`, { ...write, body });
    if (!res.ok) throw new BillingUnavailable();
  }
}

export function billingRefusal(kind: "placement" | "cancellation"): ApiError {
  return new ApiError("billing_unavailable", {
    message: kind === "placement" ? "Billing is unavailable. Your order was not placed." : "Billing is unavailable. Your order was not cancelled.",
  });
}
