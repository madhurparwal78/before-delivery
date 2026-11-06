import { config } from "../db";
import { PRODUCER_TIMEOUT_MS } from "../config";

export interface KbResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export class KbTimeout extends Error {
  constructor() {
    super("Kill Bill did not answer in time");
  }
}

export class KbUnreachable extends Error {
  constructor(override readonly cause: string) {
    super(`Kill Bill is unreachable: ${cause}`);
  }
}

function kbFetch(path: string, init: RequestInit, timeoutMs = PRODUCER_TIMEOUT_MS): Promise<KbResponse> {
  const url = `${config.killbillUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    "X-Killbill-ApiKey": config.killbillApiKey,
    "X-Killbill-ApiSecret": config.killbillApiSecret,
    "X-Killbill-CreatedBy": "tare-and-tally",
    ...(init.headers as Record<string, string>),
  };
  return fetch(url, { ...init, headers, signal: controller.signal })
    .then(async (res) => {
      const text = await res.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        outHeaders[k.toLowerCase()] = v;
      });
      return { status: res.status, body, headers: outHeaders };
    })
    .finally(() => clearTimeout(timer))
    .catch((e: unknown) => {
      if (e instanceof Error && e.name === "AbortError") throw new KbTimeout();
      throw new KbUnreachable(e instanceof Error ? e.message : String(e));
    });
}

function authHeader(): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64")}` };
}

/** Finds the household's account by external key, or null when Kill Bill has none. */
export async function findAccount(externalKey: string): Promise<string | null> {
  const res = await kbFetch(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, {
    method: "GET",
    headers: authHeader(),
  });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Kill Bill account lookup failed: ${res.status}`);
  const body = res.body as { accountId?: string };
  if (typeof body?.accountId === "string") return body.accountId;
  return null;
}

export async function createAccount(externalKey: string, name: string, email: string): Promise<string> {
  const res = await kbFetch(`/1.0/kb/accounts`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ externalKey, name, email, currency: "USD" }),
  });
  if (res.status !== 201 || !res.headers.location) throw new Error(`Kill Bill account creation failed: ${res.status}`);
  const accountId = res.headers.location.split("/").pop();
  if (!accountId) throw new Error("Kill Bill account id missing");
  return accountId;
}

export async function ensurePaymentMethod(accountId: string): Promise<void> {
  const create = await kbFetch(`/1.0/kb/accounts/${accountId}/paymentMethods`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", isDefault: true, pluginInfo: {} }),
  });
  if (create.status !== 201 || !create.headers.location) {
    if (create.status === 400) {
      // An external payment method already exists on this account.
      const body = create.body as { message?: string };
      if (typeof body?.message === "string" && body.message.includes("already exists")) return;
    }
    throw new Error(`Kill Bill payment method failed: ${create.status}`);
  }
  const methodId = create.headers.location.split("/").pop()!;
  const setDefault = await kbFetch(
    `/1.0/kb/accounts/${accountId}/paymentMethods/${methodId}/setDefault?payAllUnpaidInvoices=false`,
    { method: "PUT", headers: authHeader() }
  );
  if (setDefault.status !== 204) throw new Error(`Kill Bill set default method failed: ${setDefault.status}`);
}

export interface KbPayment {
  purchasedAmount: unknown;
  transactions: {
    transactionType: string;
    amount: unknown;
    status: string;
  }[];
}

/** The payment with this external key, or null. */
export async function findPaymentByExternalKey(paymentExternalKey: string): Promise<KbPayment | null> {
  const res = await kbFetch(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`, {
    method: "GET",
    headers: authHeader(),
  });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Kill Bill payment lookup failed: ${res.status}`);
  return res.body as KbPayment;
}

export async function createPurchase(
  accountId: string,
  dollars: string,
  paymentExternalKey: string
): Promise<void> {
  const body = {
    transactionType: "PURCHASE",
    amount: JSON.parse(dollars) as number,
    currency: "USD",
    paymentExternalKey,
    transactionExternalKey: paymentExternalKey,
  };
  const res = await kbFetch(`/1.0/kb/accounts/${accountId}/payments`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`Kill Bill purchase failed: ${res.status}`);
}

export interface KbInvoiceItem {
  itemType: string;
  description: string | null;
  amount: unknown;
}

export interface KbInvoice {
  status: string;
  items: KbInvoiceItem[];
}

export async function listInvoices(accountId: string): Promise<KbInvoice[]> {
  const res = await kbFetch(
    `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`,
    { method: "GET", headers: authHeader() }
  );
  if (res.status !== 200) throw new Error(`Kill Bill invoice listing failed: ${res.status}`);
  return res.body as KbInvoice[];
}

export interface KbCharge {
  amount: string; // dollars with two decimals
  description: string;
}

/** Posts all charges on one committed invoice. */
export async function postCharges(accountId: string, charges: KbCharge[]): Promise<void> {
  const body = charges.map((c) => ({ amount: JSON.parse(c.amount) as number, description: c.description }));
  const res = await kbFetch(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`Kill Bill charge post failed: ${res.status}`);
}

let statusCache: { state: "available" | "paused"; checkedAt: number } = { state: "available", checkedAt: 0 };

export async function paymentsStatus(): Promise<"available" | "paused"> {
  const now = Date.now();
  if (now - statusCache.checkedAt <= 2000) return statusCache.state;
  try {
    await kbFetch(`/1.0/kb/accounts?externalKey=${encodeURIComponent("tally-status-probe")}`, {
      method: "GET",
      headers: authHeader(),
    }, 2500);
    statusCache = { state: "available", checkedAt: now };
  } catch {
    statusCache = { state: "paused", checkedAt: now };
  }
  return statusCache.state;
}
