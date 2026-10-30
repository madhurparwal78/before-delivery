// Kill Bill over its REST API, with the tenant named by KILLBILL_API_KEY / KILLBILL_API_SECRET.
// Any failure to get an answer (or a refusal) is a ServiceDown("killbill"): money never moves on a guess.
import { config } from "../config.ts";
import { db, type Db } from "../db/index.ts";
import { ServiceDown } from "./serviceDown.ts";

const TIMEOUT_MS = 10_000;
const CREATED_BY = "kerf-frequencies";
const EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__";
const INVOICE_CONTROL_PLUGIN = "__INVOICE_PAYMENT_CONTROL_PLUGIN__";
const AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";
const WRITTEN_OFF_TAG = "00000000-0000-0000-0000-000000000004";

type KbResponse = { status: number; location: string | null; json: unknown };

async function call(method: string, path: string, body?: unknown, accept404 = false): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64"),
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": CREATED_BY,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ServiceDown("killbill", error);
  }
  const text = await response.text();
  if (response.status === 404 && accept404) return { status: 404, location: null, json: null };
  if (response.status >= 300) throw new ServiceDown("killbill", new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`));
  return { status: response.status, location: response.headers.get("location"), json: text ? JSON.parse(text) : null };
}

const euros = (cents: number) => Number((cents / 100).toFixed(2));
export const kbCents = (amount: unknown) => (amount === null || amount === undefined ? 0 : Math.round(Number(amount) * 100));
const idFromLocation = (location: string | null) => (location ?? "").replace(/\/+$/, "").split("/").pop() ?? "";

export type KbTransaction = {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amount: number | null;
  status: string;
};
type KbPayment = { paymentId: string; paymentExternalKey: string; transactions: KbTransaction[] };

/**
 * One account per buyer (kerf-user-<id>) or organisation (kerf-org-<id>), paying through the external plugin.
 * Organisation accounts carry AUTO_PAY_OFF: their invoices are collected on the due date, never at issue.
 */
export async function accountFor(externalKey: string, name: string, email: string | null): Promise<string> {
  const known = await db.one<{ account_id: string }>("SELECT account_id FROM killbill_accounts WHERE external_key = $1", [externalKey]);
  if (known) return known.account_id;
  let found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, true);
  if (found.status === 404) {
    try {
      await call("POST", "/accounts", { name, email, currency: "EUR", externalKey });
    } catch (error) {
      found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, true);
      if (found.status === 404) throw error;
    }
    found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  }
  const account = found.json as { accountId: string; paymentMethodId: string | null };
  if (!account.paymentMethodId) {
    await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PLUGIN, pluginInfo: {} });
  }
  if (externalKey.startsWith("kerf-org-")) {
    const tags = (await call("GET", `/accounts/${account.accountId}/tags`)).json as { tagDefinitionId: string }[];
    if (!tags.some((t) => t.tagDefinitionId === AUTO_PAY_OFF_TAG)) await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  }
  await db.query("INSERT INTO killbill_accounts (external_key, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [externalKey, account.accountId]);
  return account.accountId;
}

async function payment(paymentId: string): Promise<KbPayment> {
  return (await call("GET", `/payments/${paymentId}`)).json as KbPayment;
}

function transactionByKey(found: KbPayment, key: string): KbTransaction {
  const tx = found.transactions.find((t) => t.transactionExternalKey === key);
  if (!tx || tx.status !== "SUCCESS") throw new ServiceDown("killbill", new Error(`transaction ${key} not successful`));
  return tx;
}

export async function authorize(accountId: string, ref: string, cents: number): Promise<{ paymentId: string; tx: KbTransaction }> {
  const created = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "AUTHORIZE", amount: euros(cents), currency: "EUR", paymentExternalKey: ref, transactionExternalKey: `${ref}-auth`,
  });
  const paymentId = idFromLocation(created.location);
  return { paymentId, tx: transactionByKey(await payment(paymentId), `${ref}-auth`) };
}

export async function capture(paymentId: string, ref: string, cents: number): Promise<KbTransaction> {
  await call("POST", `/payments/${paymentId}`, { amount: euros(cents), currency: "EUR", transactionExternalKey: `${ref}-capture` });
  return transactionByKey(await payment(paymentId), `${ref}-capture`);
}

export async function voidPayment(paymentId: string, ref: string): Promise<KbTransaction> {
  await call("DELETE", `/payments/${paymentId}`, { transactionExternalKey: `${ref}-void` });
  return transactionByKey(await payment(paymentId), `${ref}-void`);
}

export async function refund(paymentId: string, refundId: string, cents: number): Promise<KbTransaction> {
  await call("POST", `/payments/${paymentId}/refunds`, { amount: euros(cents), currency: "EUR", transactionExternalKey: refundId });
  return transactionByKey(await payment(paymentId), refundId);
}

type KbCharge = { description: string; cents: number };

/** One invoice from external charges, one item per line; returns the invoice id and item ids in order. */
export async function invoiceCharges(accountId: string, charges: readonly KbCharge[]): Promise<{ invoiceId: string; itemIds: string[] }> {
  const created = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`,
    charges.map((c) => ({ accountId, amount: euros(c.cents), currency: "EUR", description: c.description })));
  const items = created.json as { invoiceId: string; invoiceItemId: string }[];
  return { invoiceId: items[0]!.invoiceId, itemIds: items.map((i) => i.invoiceItemId) };
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

export async function adjustItem(accountId: string, invoiceId: string, itemId: string, cents: number, description: string): Promise<void> {
  await call("POST", `/invoices/${invoiceId}`, { accountId, invoiceItemId: itemId, amount: euros(cents), currency: "EUR", description });
}

/** A collection: a payment on the invoice, external key <invoice number>-<attempt number>. */
export async function collect(accountId: string, invoiceId: string, key: string, cents: number): Promise<{ paymentId: string; tx: KbTransaction }> {
  const created = await call("POST",
    `/accounts/${accountId}/payments?controlPluginName=${INVOICE_CONTROL_PLUGIN}&pluginProperty=${encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`)}`,
    { transactionType: "PURCHASE", amount: euros(cents), currency: "EUR", paymentExternalKey: key, transactionExternalKey: key });
  const paymentId = idFromLocation(created.location);
  return { paymentId, tx: transactionByKey(await payment(paymentId), key) };
}

/** A bank return: a chargeback through the invoice payment, which reopens the invoice balance for the retries. */
export async function chargeback(paymentId: string, key: string, cents: number): Promise<KbTransaction> {
  await call("POST", `/invoicePayments/${paymentId}/chargebacks`, { paymentId, amount: euros(cents), currency: "EUR", transactionExternalKey: key });
  return transactionByKey(await payment(paymentId), key);
}

export async function writeOff(invoiceId: string): Promise<void> {
  await call("POST", `/invoices/${invoiceId}/tags`, [WRITTEN_OFF_TAG]);
}

/** Every account whose external key starts with kerf-, with all its payments. */
export async function kerfPayments(): Promise<KbPayment[]> {
  const out: KbPayment[] = [];
  const pageSize = 200;
  const parallel = 8;
  for (let offset = 0; ; offset += pageSize) {
    const page = (await call("GET", `/accounts/search/kerf-?offset=${offset}&limit=${pageSize}`)).json as { accountId: string; externalKey: string }[];
    const accounts = page.filter((a) => a.externalKey.startsWith("kerf-"));
    // A few accounts at a time keeps a run short without flooding Kill Bill.
    for (let i = 0; i < accounts.length; i += parallel) {
      const batch = await Promise.all(accounts.slice(i, i + parallel).map(async (account) =>
        (await call("GET", `/accounts/${account.accountId}/payments`)).json as KbPayment[]));
      out.push(...batch.flat());
    }
    if (page.length < pageSize) return out;
  }
}

export async function killbillUp(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(1500) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

export async function recordTransaction(
  q: Db,
  paymentId: string, tx: KbTransaction, link: { orderRef?: string; invoiceNumber?: string },
): Promise<void> {
  await q.query(
    `INSERT INTO payment_records (kb_transaction_id, kb_payment_id, transaction_type, amount_cents, status, order_ref, invoice_number, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (kb_transaction_id) DO NOTHING`,
    [tx.transactionId, paymentId, tx.transactionType, kbCents(tx.amount), tx.status, link.orderRef ?? null, link.invoiceNumber ?? null, new Date()]);
}
