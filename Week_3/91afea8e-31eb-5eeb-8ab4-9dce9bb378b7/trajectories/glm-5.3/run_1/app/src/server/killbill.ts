import { config } from "./config.js";
import { postJson } from "./providers.js";

const KB = config.killbill;

function headers(): Record<string, string> {
  const auth = Buffer.from(`${KB.username}:${KB.password}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "X-Killbill-ApiKey": KB.apiKey,
    "X-Killbill-ApiSecret": KB.apiSecret,
    "X-Killbill-CreatedBy": "chauraha",
    "Content-Type": "application/json",
  };
}

export interface KbPayment {
  paymentId: string;
  purchasedAmount: number | null;
  refundedAmount: number | null;
  transactions: Array<{ transactionType: string; status: string; amount: number; transactionExternalKey?: string }>;
}

export async function kbHealthy(): Promise<boolean> {
  if (!KB.url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${KB.url}/1.0/kb/healthcheck`, { headers: headers(), signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Create the shopper account (idempotent by external key) and return its UUID. */
export async function ensureKbAccount(accountId: string, name: string): Promise<string | null> {
  const found = await kbGet(`/1.0/kb/accounts/search/shopper-${encodeURIComponent(accountId)}?offset=0&limit=1`);
  if (found && found.status === 200 && Array.isArray(found.json)) {
    const match = (found.json as Array<{ externalKey: string; accountId: string }>)
      .find((a) => a.externalKey === `shopper-${accountId}`);
    if (match) return match.accountId;
  }
  const created = await kbPost(`/1.0/kb/accounts?createdBy=chauraha`, { name, externalKey: `shopper-${accountId}`, currency: "INR" });
  if (created === null) return null;
  if (created.location) {
    const uuid = created.location.split("/").pop() ?? "";
    if (uuid) return uuid;
  }
  const again = await kbGet(`/1.0/kb/accounts/search/shopper-${encodeURIComponent(accountId)}?offset=0&limit=1`);
  if (again && again.status === 200 && Array.isArray(again.json)) {
    const match = (again.json as Array<{ externalKey: string; accountId: string }>)
      .find((a) => a.externalKey === `shopper-${accountId}`);
    if (match) return match.accountId;
  }
  return null;
}

interface KbReply { status: number; json: unknown; location?: string }

async function kbGet(path: string): Promise<KbReply | null> {
  if (!KB.url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${KB.url}${path}`, { headers: headers(), signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, location: res.headers.get("location") ?? undefined };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function kbPost(path: string, body: unknown, method = "POST"): Promise<KbReply | null> {
  if (!KB.url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${KB.url}${path}`, {
      method,
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, location: res.headers.get("location") ?? undefined };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function kbHealth(): Promise<boolean> {
  return kbHealthy();
}

/**
 * Record one PURCHASE leg. Flow: an external-charge invoice per leg amount, commit, then an
 * external payment against it. The payment external key is the leg's transaction key, so a
 * retry of the same key is a no-op returning the existing payment.
 */
export async function kbRecordPurchase(
  kbAccountUuid: string, amountPaise: number, paymentExternalKey: string, transactionExternalKey: string,
): Promise<{ ok: boolean; paymentId: string | null }> {
  const rupees = amountPaise / 100;
  const seen = await kbGet(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`);
  if (seen && seen.status === 200 && seen.json) {
    const payment = seen.json as KbPayment;
    const success = payment.transactions?.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
    if (success) return { ok: true, paymentId: payment.paymentId };
  }
  const charge = await kbPost(`/1.0/kb/invoices/charges/${kbAccountUuid}`, [
    { description: paymentExternalKey, amount: rupees, currency: "INR" },
  ]);
  if (charge === null || charge.status >= 300) return { ok: false, paymentId: null };
  const items = charge.json as Array<{ invoiceId: string }> | null;
  const invoiceId = items?.[0]?.invoiceId;
  if (!invoiceId) return { ok: false, paymentId: null };
  const commit = await kbPost(`/1.0/kb/invoices/${invoiceId}/commitInvoice`, null, "PUT");
  if (commit === null || commit.status >= 300) return { ok: false, paymentId: null };
  const pay = await kbPost(`/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId: kbAccountUuid,
    targetInvoiceId: invoiceId,
    purchasedAmount: rupees,
    currency: "INR",
    paymentExternalKey,
    transactions: [{ transactionType: "PURCHASE", amount: rupees, currency: "INR", transactionExternalKey }],
  });
  if (pay === null || pay.status >= 300) return { ok: false, paymentId: null };
  const detail = await kbGet(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`);
  const paymentId = detail && detail.status === 200 && detail.json ? (detail.json as KbPayment).paymentId : null;
  return { ok: true, paymentId };
}

export async function kbRecordRefund(
  kbPaymentId: string, amountPaise: number, transactionExternalKey: string,
): Promise<boolean> {
  const rupees = amountPaise / 100;
  const already = await kbGet(`/1.0/kb/payments/${kbPaymentId}`);
  if (already && already.status === 200 && already.json) {
    const payment = already.json as KbPayment;
    const prior = payment.transactions?.find((t) => t.transactionExternalKey === transactionExternalKey && t.status === "SUCCESS");
    if (prior) return true;
  }
  const refund = await kbPost(`/1.0/kb/payments/${kbPaymentId}/refunds`, {
    amount: rupees, currency: "INR", transactionExternalKey,
  });
  return refund !== null && refund.status < 300;
}

export async function kbRefundedAmount(kbPaymentId: string): Promise<number | null> {
  const res = await kbGet(`/1.0/kb/payments/${kbPaymentId}`);
  if (!res || res.status !== 200 || !res.json) return null;
  const payment = res.json as KbPayment;
  const refunded = payment.refundedAmount ?? 0;
  const successful = (payment.transactions ?? [])
    .filter((t) => t.transactionType === "REFUND" && t.status === "SUCCESS")
    .reduce((a, t) => a + t.amount, 0);
  void refunded;
  return Math.round(successful * 100);
}

export async function kbGetPaymentByKey(paymentExternalKey: string): Promise<KbPayment | null> {
  const res = await kbGet(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`);
  if (!res || res.status !== 200 || !res.json) return null;
  return res.json as KbPayment;
}

export { postJson };
