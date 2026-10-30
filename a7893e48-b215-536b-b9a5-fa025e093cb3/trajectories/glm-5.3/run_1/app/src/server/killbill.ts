import { KILLBILL } from "./config.js";
import { ApiError, billingUnavailable } from "./errors.js";

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: { transactionId: string; transactionExternalKey: string; transactionType: string; amount: number; status: string }[];
}

let health = { ok: false, lastCheck: 0 };

export function setBillingHealth(ok: boolean): void {
  health = { ok, lastCheck: Date.now() };
}
export function billingOk(): boolean {
  return health.ok;
}
export async function checkBilling(): Promise<boolean> {
  try {
    const r = await request("GET", "/1.0/kb/healthcheck", undefined, 5000);
    setBillingHealth(r.status >= 200 && r.status < 500);
    return health.ok;
  } catch {
    setBillingHealth(false);
    return false;
  }
}

interface KbResult {
  status: number;
  body: string;
  location: string | null;
}

async function request(method: string, path: string, body: unknown | undefined, timeoutMs: number): Promise<KbResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const auth = "Basic " + Buffer.from(`${KILLBILL.username}:${KILLBILL.password}`).toString("base64");
    const headers: Record<string, string> = {
      Authorization: auth,
      "X-Killbill-ApiKey": KILLBILL.apiKey,
      "X-Killbill-ApiSecret": KILLBILL.apiSecret,
      "X-Killbill-CreatedBy": "hearthshift",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(KILLBILL.url + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      lastFailureDetail = `${method} ${path} -> unreachable`;
      throw failure();
    }
    const text = await res.text().catch(() => "");
    if (res.status >= 400) {
      lastFailureDetail = `${method} ${path} -> ${res.status} ${text.slice(0, 200)}`;
    } else {
      lastFailureDetail = "";
    }
    return { status: res.status, body: text, location: res.headers.get("Location") };
  } finally {
    clearTimeout(timer);
  }
}

let lastFailureDetail = "";

function failure(): ApiError {
  setBillingHealth(false);
  const err = billingUnavailable();
  if (lastFailureDetail) console.error("killbill call failed:", lastFailureDetail);
  return err;
}

export interface RenterBilling {
  id: string;
  name: string;
  email: string;
}

/** The account id for a renter, creating the account and external payment method when needed. */
export async function ensureAccount(renter: RenterBilling): Promise<string> {
  const existing = await findAccount(renter.id);
  if (existing) {
    if (!existing.paymentMethodId) await addExternalMethod(existing.accountId);
    return existing.accountId;
  }
  const created = await request("POST", "/1.0/kb/accounts", {
    name: renter.name, email: renter.email, externalKey: `hs-renter-${renter.id}`, currency: "USD",
  }, 15000);
  if (created.status === 201) {
    const accountId = created.location ? created.location.split("/").pop()! : (await findAccount(renter.id))?.accountId;
    if (!accountId) throw failure();
    await addExternalMethod(accountId);
    return accountId;
  }
  // A concurrent create may have won: look again.
  const again = await findAccount(renter.id);
  if (again) return again.accountId;
  throw failure();
}

async function findAccount(renterId: string): Promise<{ accountId: string; paymentMethodId: string | null } | null> {
  const key = `hs-renter-${renterId}`;
  const r = await request("GET", `/1.0/kb/accounts/search/${encodeURIComponent(key)}`, undefined, 8000);
  if (r.status !== 200) {
    if (r.status >= 500) throw failure();
    return null;
  }
  const list = JSON.parse(r.body || "[]") as { accountId: string; externalKey: string; paymentMethodId: string | null }[];
  const acct = list.find(a => a.externalKey === key);
  return acct ? { accountId: acct.accountId, paymentMethodId: acct.paymentMethodId } : null;
}

async function addExternalMethod(accountId: string): Promise<void> {
  const r = await request("POST", `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: "__EXTERNAL_PAYMENT__",
  }, 10000);
  if (r.status !== 201 && r.status >= 500) throw failure();
}

/**
 * PURCHASE with an external key. Returns { already: true } when the purchase
 * already existed, so a repeated request never charges twice.
 */
export async function purchase(
  renter: RenterBilling,
  externalKey: string,
  cents: number,
): Promise<{ already: boolean; paymentId: string }> {
  const accountId = await ensureAccount(renter);
  const existing = await findPayment(externalKey);
  if (existing) return { already: true, paymentId: existing.paymentId };
  const r = await request("POST", `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: "PURCHASE",
    amount: cents / 100,
    currency: "USD",
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  }, 20000);
  if (r.status === 201) {
    const p = await findPayment(externalKey);
    if (!p) throw failure();
    return { already: false, paymentId: p.paymentId };
  }
  const already = await findPayment(externalKey);
  if (already) return { already: true, paymentId: already.paymentId };
  throw failure();
}

export async function findPayment(paymentExternalKey: string): Promise<KbPayment | null> {
  const r = await request("GET", `/1.0/kb/payments/search/${encodeURIComponent(paymentExternalKey)}`, undefined, 8000);
  if (r.status === 404) return null;
  if (r.status !== 200) throw failure();
  const list = JSON.parse(r.body || "[]") as KbPayment[];
  return list.find(p => p.paymentExternalKey === paymentExternalKey) ?? null;
}

/** A payment exists, its PURCHASE succeeded and no REFUND covers it fully. */
export async function paymentHeld(externalKey: string): Promise<boolean> {
  const p = await findPayment(externalKey); // throws only when billing is unreachable
  if (!p) return false;
  const purchase = p.transactions.find(t => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
  if (!purchase) return false;
  const refunded = p.transactions.filter(t => t.transactionType === "REFUND" && t.status === "SUCCESS").reduce((s, t) => s + t.amount, 0);
  return refunded < purchase.amount;
}

export async function refund(
  externalKey: string,
  cents: number,
): Promise<void> {
  const p = await findPayment(externalKey); // throws only when billing is unreachable
  if (!p) return; // no payment was ever taken under this key
  const purchase = p.transactions.find(t => t.transactionType === "PURCHASE");
  if (!purchase) return;
  const refunded = p.transactions.filter(t => t.transactionType === "REFUND" && t.status === "SUCCESS").reduce((s, t) => s + t.amount, 0);
  const toRefund = purchase.amount - refunded;
  if (toRefund <= 0.001) return; // already fully refunded
  const r = await request("POST", `/1.0/kb/payments/${p.paymentId}/refunds`, {
    transactionType: "REFUND",
    amount: Math.min(toRefund, cents / 100),
    currency: "USD",
    transactionExternalKey: `${externalKey}-refund`,
  }, 20000);
  if (r.status !== 201) {
    // maybe a concurrent refund won
    const again = await findPayment(externalKey);
    if (again) {
      const refunded2 = again.transactions.filter(t => t.transactionType === "REFUND" && t.status === "SUCCESS").reduce((s, t) => s + t.amount, 0);
      if (refunded2 >= refunded + toRefund - 0.001) return;
    }
    throw failure();
  }
}
