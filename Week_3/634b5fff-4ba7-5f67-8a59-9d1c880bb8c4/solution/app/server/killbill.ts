import { fromDecimalKroner, toDecimalKroner } from "../shared/money.js";
import { config } from "./config.js";
import { pool } from "./db.js";

/** Kill Bill: the billing ledger. Money is held by the gateway, so payments use the external payment method. */

export class LedgerUnreachable extends Error {
  constructor() {
    super("ledger unreachable");
  }
}

const BASE = `${config.killbill.url}/1.0/kb`;
const headers = (): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
  "x-killbill-apikey": config.killbill.apiKey,
  "x-killbill-apisecret": config.killbill.apiSecret,
  "x-killbill-createdby": "svovlstik-press",
  "content-type": "application/json",
  accept: "application/json",
});

interface Reply {
  status: number;
  body: unknown;
  location: string | null;
}

const call = async (method: string, path: string, body?: unknown): Promise<Reply> => {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new LedgerUnreachable();
  }
  if (response.status >= 500) throw new LedgerUnreachable();
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, location: response.headers.get("location") };
};

const must = (reply: Reply): Reply => {
  if (reply.status >= 400) throw new LedgerUnreachable();
  return reply;
};

interface KbTransaction {
  type: string;
  amountOre: number | null;
}

interface RawPayment {
  paymentId: string;
  transactions: { transactionType: string; amount: number | null; transactionExternalKey?: string }[];
}

interface RawInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  description: string;
  amount: number;
  itemType: string;
  linkedInvoiceItemId: string | null;
}

export type ShareName = "maker share" | "charity share" | "VAT" | "courier";

/** The account for a buyer email, created once with the external payment method as its default. */
export const ensureAccount = async (email: string, name: string): Promise<string> => {
  const key = email.toLowerCase();
  const known = await pool.query("SELECT account_id FROM kb_accounts WHERE email = $1", [key]);
  if (known.rows[0]) return known.rows[0].account_id as string;
  let found = await call("GET", `/accounts?externalKey=${encodeURIComponent(key)}`);
  if (found.status === 404) {
    const created = await call("POST", "/accounts", { name, email: key, externalKey: key, currency: "DKK" });
    if (created.status !== 409) must(created);
    found = must(await call("GET", `/accounts?externalKey=${encodeURIComponent(key)}`));
    const accountId = (found.body as { accountId: string }).accountId;
    must(await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" }));
  }
  const accountId = (must(found).body as { accountId: string }).accountId;
  await pool.query("INSERT INTO kb_accounts (email, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [key, accountId]);
  return accountId;
};

/** One committed invoice with the four shares as external charges; returns the invoice id. */
export const createInvoice = async (accountId: string, shares: Record<ShareName, number>): Promise<string> => {
  const items = (Object.entries(shares) as [ShareName, number][]).map(([description, ore]) => ({
    accountId, amount: toDecimalKroner(ore), currency: "DKK", description,
  }));
  const created = must(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, items));
  return (created.body as RawInvoiceItem[])[0]?.invoiceId ?? "";
};

const loadPayment = async (reference: string): Promise<RawPayment | null> => {
  const found = await call("GET", `/payments?externalKey=${encodeURIComponent(reference)}`);
  return found.status === 404 ? null : (must(found).body as RawPayment);
};

export const transactions = async (reference: string): Promise<KbTransaction[]> => {
  const payment = await loadPayment(reference);
  return (payment?.transactions ?? []).map((item) => ({ type: item.transactionType, amountOre: fromDecimalKroner(item.amount) }));
};

/** Records a payment transaction once per transaction key; returns the Kill Bill payment id. */
export const recordPayment = async (
  accountId: string, reference: string, type: "AUTHORIZE" | "PURCHASE" | "CAPTURE" | "REFUND" | "VOID",
  amountOre: number, transactionKey: string,
): Promise<string> => {
  const payment = await loadPayment(reference);
  if (payment?.transactions.some((item) => item.transactionExternalKey === transactionKey)) return payment.paymentId;
  const amount = { amount: toDecimalKroner(amountOre), currency: "DKK", transactionExternalKey: transactionKey };
  if (type === "AUTHORIZE" || type === "PURCHASE") {
    must(await call("POST", `/accounts/${accountId}/payments`, {
      transactionType: type, paymentExternalKey: reference, ...amount,
    }));
    const created = await loadPayment(reference);
    return created?.paymentId ?? "";
  }
  const paymentId = payment?.paymentId ?? "";
  if (type === "CAPTURE") must(await call("POST", `/payments/${paymentId}`, amount));
  else if (type === "REFUND") must(await call("POST", `/payments/${paymentId}/refunds`, amount));
  else must(await call("DELETE", `/payments/${paymentId}`, { transactionExternalKey: transactionKey }));
  return paymentId;
};

const loadItems = async (accountId: string): Promise<RawInvoiceItem[]> => {
  const invoices = must(await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`));
  return (invoices.body as { items: RawInvoiceItem[] }[]).flatMap((invoice) => invoice.items);
};

interface InvoiceView {
  invoiceId: string;
  items: { description: string; amountOre: number }[];
}

/** The invoice's items with every adjustment folded into the item it adjusts. */
export const invoiceView = async (accountId: string, invoiceId: string): Promise<InvoiceView> => {
  const items = (await loadItems(accountId)).filter((item) => item.invoiceId === invoiceId);
  const originals = items.filter((item) => item.itemType === "EXTERNAL_CHARGE");
  return {
    invoiceId,
    items: originals.map((original) => ({
      description: original.description,
      amountOre: items
        .filter((item) => item.invoiceItemId === original.invoiceItemId || item.linkedInvoiceItemId === original.invoiceItemId)
        .reduce((sum, item) => sum + (fromDecimalKroner(item.amount) ?? 0), 0),
    })),
  };
};

/** Lowers shares on the invoice by the given øre, once per adjustment key. */
export const adjustShares = async (
  accountId: string, invoiceId: string, reductions: Partial<Record<ShareName, number>>, adjustmentKey: string,
): Promise<void> => {
  const items = (await loadItems(accountId)).filter((item) => item.invoiceId === invoiceId);
  for (const [description, ore] of Object.entries(reductions) as [ShareName, number][]) {
    if (ore <= 0) continue;
    const original = items.find((item) => item.itemType === "EXTERNAL_CHARGE" && item.description === description);
    if (!original) continue;
    const marker = `${adjustmentKey}:${description}`;
    if (items.some((item) => item.linkedInvoiceItemId === original.invoiceItemId && item.description === marker)) continue;
    must(await call("POST", `/invoices/${invoiceId}`, {
      accountId, invoiceId, invoiceItemId: original.invoiceItemId, amount: toDecimalKroner(ore), currency: "DKK", description: marker,
    }));
  }
};

/** Cheap reachability probe used before the gateway is called. */
export const assertReachable = async (): Promise<void> => {
  await call("GET", "/accounts?externalKey=reachability-probe");
};
