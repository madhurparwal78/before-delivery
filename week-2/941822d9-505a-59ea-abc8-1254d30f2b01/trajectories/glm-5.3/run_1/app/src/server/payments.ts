import { config } from "./config.ts";

// Kill Bill writes go through here. Every write names the acting Credwell user
// so the audit log attributes the change to them.

const BASE = () => `${config.killbill.url.replace(/\/$/, "")}/1.0/kb`;

export class PaymentsUnavailable extends Error {}

const authHeaders = (): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
  "X-Killbill-ApiKey": config.killbill.apiKey,
  "X-Killbill-ApiSecret": config.killbill.apiSecret,
});

async function call(path: string, init: { method: string; body?: string; headers?: Record<string, string> }, actingUserId: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE()}${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        "X-Killbill-CreatedBy": `credwell:${actingUserId}`,
        ...(init.headers as Record<string, string>),
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new PaymentsUnavailable("killbill timeout");
    throw new PaymentsUnavailable((e as Error).message);
  }
  if (response.status >= 500 || response.status === 404 && response.headers.get("content-type")?.includes("text/html")) {
    throw new PaymentsUnavailable(`killbill ${response.status}`);
  }
  return response;
}

export type KillBillAccount = { accountId: string; paymentMethodId: string };

export async function ensureAccount(externalKey: string, name: string, actingUserId: string): Promise<KillBillAccount> {
  const byKey = await call(`/accounts?externalKey=${encodeURIComponent(externalKey)}`, { method: "GET" }, actingUserId);
  let accountId: string | null = null;
  if (byKey.status === 200) {
    const body = (await byKey.json()) as { accountId?: string };
    accountId = body.accountId ?? null;
  }
  if (!accountId) {
    const created = await call(`/accounts`, {
      method: "POST",
      body: JSON.stringify({ name, externalKey, currency: "USD" }),
    }, actingUserId);
    if (created.status !== 201) throw new PaymentsUnavailable(`account create ${created.status}`);
    const loc = created.headers.get("location") ?? "";
    accountId = loc.split("/").filter(Boolean).pop() ?? null;
    if (!accountId) throw new PaymentsUnavailable("no account id");
  }
  const methods = await call(`/accounts/${accountId}/paymentMethods`, { method: "GET" }, actingUserId);
  let paymentMethodId: string | null = null;
  if (methods.status === 200) {
    const list = (await methods.json()) as Array<{ paymentMethodId: string; isDefault: boolean }>;
    const def = list.find((m) => m.isDefault) ?? list[0];
    paymentMethodId = def?.paymentMethodId ?? null;
    if (def && !def.isDefault) {
      await call(`/accounts/${accountId}/paymentMethods/${def.paymentMethodId}/setDefault`, { method: "PUT" }, actingUserId);
    }
  }
  if (!paymentMethodId) {
    const pm = await call(`/accounts/${accountId}/paymentMethods`, {
      method: "POST",
      body: JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", isDefault: true }),
    }, actingUserId);
    if (pm.status !== 201) throw new PaymentsUnavailable(`payment method ${pm.status}`);
    const list = await call(`/accounts/${accountId}/paymentMethods`, { method: "GET" }, actingUserId);
    if (list.status === 200) {
      const arr = (await list.json()) as Array<{ paymentMethodId: string }>;
      paymentMethodId = arr[0]?.paymentMethodId ?? null;
    }
    if (!paymentMethodId) throw new PaymentsUnavailable("payment method missing");
  }
  return { accountId, paymentMethodId };
}

export type PaymentRef = { paymentId: string; transactionId: string };

export async function purchase(
  externalAccountKey: string,
  accountName: string,
  amountCents: number,
  transactionExternalKey: string,
  actingUserId: string,
): Promise<PaymentRef> {
  const account = await ensureAccount(externalAccountKey, accountName, actingUserId);
  const body = JSON.stringify({
    transactionType: "PURCHASE",
    amount: (amountCents / 100).toFixed(2),
    currency: "USD",
    transactionExternalKey,
    paymentExternalKey: transactionExternalKey,
  });
  const res = await call(
    `/accounts/${account.accountId}/payments?paymentMethodId=${account.paymentMethodId}`,
    { method: "POST", body },
    actingUserId,
  );
  if (res.status !== 201) throw new PaymentsUnavailable(`purchase ${res.status}`);
  const loc = res.headers.get("location") ?? "";
  const paymentId = loc.split("/").filter(Boolean).pop() ?? "";
  const payment = await call(`/payments/${paymentId}`, { method: "GET" }, actingUserId);
  if (payment.status !== 200) throw new PaymentsUnavailable("payment readback");
  const detail = (await payment.json()) as { transactions: Array<{ transactionId: string; transactionExternalKey: string }> };
  const txn = detail.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
  if (!txn) throw new PaymentsUnavailable("transaction missing");
  return { paymentId, transactionId: txn.transactionId };
}

export type PurchaseLookup = { paymentId: string; amountCents: number } | null;

/** Finds the payment created for a purchase by its payment external key, with
 * the purchase amount. Returns null when Kill Bill holds no such payment. */
export async function findPurchase(externalKey: string, actingUserId: string): Promise<PurchaseLookup> {
  const res = await call(`/payments/search/${encodeURIComponent(externalKey)}?limit=10`, { method: "GET" }, actingUserId);
  if (res.status !== 200) return null;
  const list = (await res.json()) as Array<{
    paymentId: string;
    paymentExternalKey: string;
    purchasedAmount: number;
    transactions: Array<{ transactionExternalKey: string; transactionType: string; amount: number }>;
  }>;
  const match = list.find((p) => p.paymentExternalKey === externalKey);
  if (!match) return null;
  return { paymentId: match.paymentId, amountCents: Math.round(match.purchasedAmount * 100) };
}

export type RefundLookup = { paymentId: string; refundedCents: number } | null;

/** Sums the refunds already recorded on a payment. */
export async function refundsOn(paymentId: string, actingUserId: string): Promise<RefundLookup> {
  const res = await call(`/payments/${paymentId}`, { method: "GET" }, actingUserId);
  if (res.status !== 200) return null;
  const detail = (await res.json()) as { refundedAmount: number };
  return { paymentId, refundedCents: Math.round(detail.refundedAmount * 100) };
}

export async function refund(
  paymentId: string,
  amountCents: number,
  transactionExternalKey: string,
  reasonCode: string,
  comment: string,
  actingUserId: string,
): Promise<PaymentRef> {
  const body = JSON.stringify({
    transactionType: "REFUND",
    amount: (amountCents / 100).toFixed(2),
    currency: "USD",
    transactionExternalKey,
  });
  const res = await call(`/payments/${paymentId}/refunds`, {
    method: "POST",
    body,
    headers: { "X-Killbill-Reason": reasonCode, "X-Killbill-Comment": comment },
  }, actingUserId);
  if (res.status !== 201) throw new PaymentsUnavailable(`refund ${res.status}`);
  const payment = await call(`/payments/${paymentId}`, { method: "GET" }, actingUserId);
  if (payment.status !== 200) throw new PaymentsUnavailable("payment readback");
  const detail = (await payment.json()) as {
    transactions: Array<{ transactionId: string; transactionExternalKey: string; status: string }>;
  };
  const txn = detail.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
  if (!txn) throw new PaymentsUnavailable("refund transaction missing");
  return { paymentId, transactionId: txn.transactionId };
}

export async function findTransactionByExternalKey(
  transactionExternalKey: string,
  actingUserId: string,
): Promise<{ paymentId: string; transactionId: string } | null> {
  const res = await call(`/payments/search/${encodeURIComponent(transactionExternalKey)}?limit=1`, { method: "GET" }, actingUserId);
  if (res.status !== 200) return null;
  const list = (await res.json()) as Array<{ paymentId: string; transactions: Array<{ transactionId: string; transactionExternalKey: string }> }>;
  for (const p of list) {
    const txn = p.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
    if (txn) return { paymentId: p.paymentId, transactionId: txn.transactionId };
  }
  return null;
}

/** True when Kill Bill already holds a transaction with this external key. */
export async function transactionExists(externalKey: string, actingUserId: string): Promise<boolean> {
  return (await findTransactionByExternalKey(externalKey, actingUserId)) !== null;
}

export async function listTransactionsForPayment(paymentId: string, actingUserId: string): Promise<Array<{ transactionExternalKey: string; amount: number; transactionType: string }>> {
  const res = await call(`/payments/${paymentId}`, { method: "GET" }, actingUserId);
  if (res.status !== 200) return [];
  const detail = (await res.json()) as { transactions: Array<{ transactionExternalKey: string; amount: number; transactionType: string }> };
  return detail.transactions.map((t) => ({ transactionExternalKey: t.transactionExternalKey, amount: t.amount, transactionType: t.transactionType }));
}
