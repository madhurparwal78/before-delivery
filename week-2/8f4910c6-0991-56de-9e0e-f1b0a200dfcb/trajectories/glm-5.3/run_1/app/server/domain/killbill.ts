import { config } from "../config.js";

/** The Kill Bill client. Every billing action goes through here. */

export class BillingOutage extends Error {}

const API = "/1.0/kb";

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "rungboard",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface KbResponse<T> {
  status: number;
  body: T;
  location: string | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<KbResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`${config.killbill.url}${API}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new BillingOutage(err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, body: parsed as T, location: res.headers.get("Location") };
}

function expectOk<T>(res: KbResponse<T>): KbResponse<T> {
  if (res.status >= 500 || res.status === 0) throw new BillingOutage(`Kill Bill ${res.status}`);
  return res;
}

export interface KbAccount {
  accountId: string;
}

/** One CAD account per client, created on first use. */
export async function createOrGetAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
  const found = await call<{ accountId: string }>("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 200 && found.body && found.body.accountId) {
    return { accountId: found.body.accountId };
  }
  if (found.status >= 500) throw new BillingOutage(`Kill Bill ${found.status}`);
  const created = await call<unknown>("POST", "/accounts", {
    name,
    email,
    externalKey,
    currency: "CAD",
    locale: "en-CA",
  });
  if (created.status === 201) {
    const id = (created.location || "").split("/accounts/")[1] || "";
    if (id) return { accountId: id.split("?")[0] };
    const again = await call<{ accountId: string }>("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (again.status === 200 && again.body?.accountId) return { accountId: again.body.accountId };
  }
  if (created.status === 409 || created.status === 400) {
    const again = await call<{ accountId: string }>("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (again.status === 200 && again.body?.accountId) return { accountId: again.body.accountId };
  }
  throw new BillingOutage(`Kill Bill create account ${created.status}`);
}

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  amount: number;
}

/** Adds one external charge per fee line without committing: Kill Bill holds one DRAFT invoice. */
export async function createDraftInvoice(accountId: string, items: Array<{ description: string; amountCents: number }>): Promise<{ invoiceId: string; invoiceNumber: number }> {
  const body = items.map((item) => ({
    amount: item.amountCents / 100,
    currency: "CAD",
    description: item.description,
    quantity: 1,
  }));
  const res = expectOk(await call<KbInvoiceItem[]>("POST", `/invoices/charges/${accountId}?autoCommit=false`, body));
  if (res.status !== 200 && res.status !== 201) throw new BillingOutage(`Kill Bill charges ${res.status}`);
  const first = Array.isArray(res.body) ? res.body[0] : null;
  if (!first || !first.invoiceId) throw new BillingOutage("Kill Bill charges returned no invoice");
  const invoice = await getInvoice(first.invoiceId);
  return { invoiceId: first.invoiceId, invoiceNumber: invoice?.invoiceNumber ?? 0 };
}

export async function getInvoice(invoiceId: string): Promise<{ status: string; invoiceNumber: number; balance: number } | null> {
  const res = expectOk(await call<{ status: string; invoiceNumber: number; balance: number }>("GET", `/invoices/${invoiceId}`));
  if (res.status !== 200) return null;
  return res.body;
}

/** Issue invoice commits the draft invoice. */
export async function commitInvoice(invoiceId: string): Promise<void> {
  const res = expectOk(await call<unknown>("PUT", `/invoices/${invoiceId}/commitInvoice`));
  if (res.status !== 204 && res.status !== 200) {
    const body = res.body as { message?: string } | null;
    if (res.status === 400 && body?.message?.includes("already committed")) return;
    throw new BillingOutage(`Kill Bill commit ${res.status}`);
  }
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const res = await call<unknown>("DELETE", `/invoices/${invoiceId}`);
  if (res.status >= 500) throw new BillingOutage(`Kill Bill void ${res.status}`);
}

/** A licence extension adds one committed external charge. */
export async function createCharge(accountId: string, description: string, amountCents: number): Promise<{ invoiceId: string; invoiceNumber: number }> {
  const body = [{ amount: amountCents / 100, currency: "CAD", description, quantity: 1 }];
  const res = expectOk(await call<KbInvoiceItem[]>("POST", `/invoices/charges/${accountId}?autoCommit=true`, body));
  if (res.status !== 200 && res.status !== 201) throw new BillingOutage(`Kill Bill charge ${res.status}`);
  const first = Array.isArray(res.body) ? res.body[0] : null;
  if (!first || !first.invoiceId) throw new BillingOutage("Kill Bill charge returned no invoice");
  return { invoiceId: first.invoiceId, invoiceNumber: 0 };
}

/** A booking reversal records one credit on the client's account. */
export async function createCredit(accountId: string, description: string, amountCents: number): Promise<{ invoiceId: string }> {
  const body = [{ amount: amountCents / 100, currency: "CAD", description, quantity: 1, accountId }];
  const res = expectOk(await call<KbInvoiceItem[]>("POST", `/credits?autoCommit=true`, body));
  if (res.status !== 200 && res.status !== 201) throw new BillingOutage(`Kill Bill credit ${res.status}`);
  const first = Array.isArray(res.body) ? res.body[0] : null;
  return { invoiceId: first?.invoiceId || "" };
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${config.killbill.url}${API}/nodesInfo`, { headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}
