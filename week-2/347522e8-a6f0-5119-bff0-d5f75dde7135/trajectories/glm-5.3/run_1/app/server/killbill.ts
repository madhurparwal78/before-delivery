import { config } from "./config.js";

// Every Kill Bill call is attempted fresh with a bounded timeout. No failure
// and no availability answer is ever cached (DP-11).

export type BillingUnavailable = { kind: "unavailable" };
export type BillingOutcome<T> = { kind: "ok"; value: T } | BillingUnavailable;

const unavailable: BillingUnavailable = { kind: "unavailable" };

async function kbRequest<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<BillingOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "railside",
    };
    const body = init.body;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
    const response = await fetch(`${config.killbill.url}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return unavailable;
    }
    return { kind: "ok", value: text ? (JSON.parse(text) as T) : (null as T) };
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timer);
  }
}

export type KillbillAccount = {
  accountId: string;
  paymentMethodId: string | null;
};

const accountOrNull = (value: { accountId: string; paymentMethodId: string | null } | null): KillbillAccount | null =>
  value ? { accountId: value.accountId, paymentMethodId: value.paymentMethodId } : null;

export const findAccount = (externalKey: string): Promise<BillingOutcome<KillbillAccount | null>> =>
  kbRequest<{ accountId: string; paymentMethodId: string | null }[]>(
    `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}?limit=1`,
    { method: "GET" },
    5000,
  ).then((r) => (r.kind === "ok" ? { kind: "ok", value: accountOrNull(r.value?.[0] ?? null) } : r));

export const createAccount = (
  externalKey: string,
  name: string,
  email: string,
): Promise<BillingOutcome<KillbillAccount>> =>
  kbRequest<{ accountId: string }>(`/1.0/kb/accounts`, {
    method: "POST",
    body: JSON.stringify({ externalKey, name, email, currency: "USD" }),
  }, 5000).then((r) =>
    r.kind === "ok" ? { kind: "ok", value: { accountId: r.value!.accountId, paymentMethodId: null } } : r,
  );

// Ensures the account has a default __EXTERNAL_PAYMENT__ payment method.
export const ensurePaymentMethod = async (
  account: KillbillAccount,
): Promise<BillingOutcome<{ paymentMethodId: string }>> => {
  if (account.paymentMethodId) return { kind: "ok", value: { paymentMethodId: account.paymentMethodId } };

  const methods = await kbRequest<{ paymentMethodId: string; isDefault: boolean }[]>(
    `/1.0/kb/accounts/${account.accountId}/paymentMethods`,
    { method: "GET" },
    5000,
  );
  if (methods.kind === "unavailable") return methods;
  const existing = methods.value?.find((m) => m.isDefault) ?? methods.value?.[0];
  if (existing) return { kind: "ok", value: { paymentMethodId: existing.paymentMethodId } };
  const created = await kbRequest<null>(
    `/1.0/kb/accounts/${account.accountId}/paymentMethods?isDefault=true`,
    {
      method: "POST",
      body: JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", isDefault: true }),
    },
    5000,
  );
  if (created.kind === "unavailable") return created;
  const after = await kbRequest<{ paymentMethodId: string; isDefault: boolean }[]>(
    `/1.0/kb/accounts/${account.accountId}/paymentMethods`,
    { method: "GET" },
    5000,
  );
  if (after.kind === "unavailable") return after;
  const added = after.value?.find((m) => m.isDefault) ?? after.value?.[0];
  return added ? { kind: "ok", value: { paymentMethodId: added.paymentMethodId } } : { kind: "unavailable" };
};

export const ensureAccount = async (
  externalKey: string,
  name: string,
  email: string,
): Promise<BillingOutcome<KillbillAccount>> => {
  const found = await findAccount(externalKey);
  if (found.kind === "unavailable") return found;
  if (found.value) return { kind: "ok", value: found.value };
  return createAccount(externalKey, name, email);
};

export type PaymentResult = { paymentId: string; status: string };

export const createPurchasePayment = (
  accountId: string,
  paymentMethodId: string,
  amount: number,
  paymentExternalKey: string,
  transactionExternalKey: string,
): Promise<BillingOutcome<PaymentResult>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  return fetch(
    `${config.killbill.url}/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`,
    {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "railside",
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        transactionType: "PURCHASE",
        amount,
        currency: "USD",
        paymentExternalKey,
        transactionExternalKey,
      }),
    },
  )
    .then(async (response) => {
      clearTimeout(timer);
      if (response.status === 400) {
        // Kill Bill answers 400 when a successful transaction with this key
        // already exists; look it up so a retry finds it instead of recharging.
        const found = await findPaymentByExternalKey(paymentExternalKey);
        if (found.kind === "ok" && found.value) {
          return { kind: "ok" as const, value: found.value };
        }
        return { kind: "unavailable" as const };
      }
      if (!response.ok) return { kind: "unavailable" as const };
      const text = await response.text();
      if (!text) {
        const found = await findPaymentByExternalKey(paymentExternalKey);
        if (found.kind === "ok" && found.value) {
          return { kind: "ok" as const, value: found.value };
        }
        return { kind: "unavailable" as const };
      }
      const parsed = JSON.parse(text) as { paymentId: string; transactions?: { status: string }[] };
      const tx = parsed.transactions?.[0];
      return { kind: "ok" as const, value: { paymentId: parsed.paymentId, status: tx?.status ?? "SUCCESS" } };
    })
    .catch(async (err: unknown) => {
      clearTimeout(timer);
      void err;
      const found = await findPaymentByExternalKey(paymentExternalKey).catch(() => null);
      if (found && found.kind === "ok" && found.value) {
        return { kind: "ok" as const, value: found.value };
      }
      return { kind: "unavailable" as const };
    });
};

export const findPaymentByExternalKey = (
  paymentExternalKey: string,
): Promise<BillingOutcome<PaymentResult | null>> =>
  kbRequest<{ paymentId: string; transactions?: { status: string }[] }[]>(
    `/1.0/kb/payments/search/${encodeURIComponent(paymentExternalKey)}`,
    { method: "GET" },
    5000,
  ).then((r) => {
    if (r.kind === "unavailable") return r;
    const first = r.value?.[0];
    return first
      ? { kind: "ok", value: { paymentId: first.paymentId, status: first.transactions?.[0]?.status ?? "SUCCESS" } }
      : { kind: "ok", value: null };
  });

export const refundPayment = (paymentId: string): Promise<BillingOutcome<null>> =>
  kbRequest<null>(`/1.0/kb/payments/${paymentId}/refunds`, {
    method: "POST",
    body: JSON.stringify({ amount: 0, currency: "USD" }),
  }, 5000);

export const createCharge = (
  accountId: string,
  amount: number,
  description: string,
  itemExternalKey: string,
): Promise<BillingOutcome<{ invoiceId: string }>> =>
  kbRequest<{ invoiceId: string }[]>(`/1.0/kb/invoices/charges/${accountId}?autoCommit=false`, {
    method: "POST",
    body: JSON.stringify([{ amount, currency: "USD", description }]),
  }, 5000).then((r): Promise<BillingOutcome<{ invoiceId: string }>> => {
    void itemExternalKey;
    if (r.kind === "unavailable") return Promise.resolve(r);
    const list = Array.isArray(r.value) ? r.value : [];
    if (list.length === 0) return Promise.resolve({ kind: "unavailable" });
    return Promise.resolve({ kind: "ok", value: { invoiceId: list[0]!.invoiceId } });
  });

export type KillbillSubscription = {
  subscriptionId: string;
  externalKey: string;
  state: string;
};

export const catalogHasPlan = (): Promise<BillingOutcome<boolean>> =>
  kbRequest<{ products?: { plans?: { name: string }[] }[] }[]>(`/1.0/kb/catalog`, { method: "GET" }, 5000).then((r) => {
    if (r.kind === "unavailable") return r;
    const versions = r.value ?? [];
    const plans: { name: string }[] = [];
    for (const version of versions) {
      for (const product of version.products ?? []) {
        for (const plan of product.plans ?? []) plans.push(plan);
      }
    }
    return { kind: "ok", value: plans.some((p) => p.name === "walk-in-shelf-monthly") };
  });

export const uploadCatalogPlan = (): Promise<BillingOutcome<null>> =>
  kbRequest<null>(`/1.0/kb/catalog/simplePlan`, {
    method: "POST",
    body: JSON.stringify({
      planId: "walk-in-shelf-monthly",
      productName: "WalkInShelf",
      productCategory: "STANDALONE",
      currency: "USD",
      amount: 45.0,
      billingPeriod: "MONTHLY",
    }),
  }, 5000);

export const createSubscription = async (
  accountId: string,
  externalKey: string,
  today: string,
): Promise<BillingOutcome<KillbillSubscription>> => {
  const hasPlan = await catalogHasPlan();
  if (hasPlan.kind === "unavailable") return hasPlan;
  if (!hasPlan.value) {
    const uploaded = await uploadCatalogPlan();
    if (uploaded.kind === "unavailable") return uploaded;
  }
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `${config.killbill.url}/1.0/kb/subscriptions?entitlementDate=${today}&billingDate=${today}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "X-Killbill-ApiKey": config.killbill.apiKey,
          "X-Killbill-ApiSecret": config.killbill.apiSecret,
          "X-Killbill-CreatedBy": "railside",
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ accountId, externalKey, planName: "walk-in-shelf-monthly" }),
      },
    );
    if (!response.ok) return { kind: "unavailable" };
    // The create answers 201 with an empty body; its Location names the
    // subscription, which is then read back for its state.
    const location = response.headers.get("location") ?? "";
    const subscriptionId = location.split("/").filter(Boolean).pop();
    if (!subscriptionId) return { kind: "unavailable" };
    const read = await getSubscription(subscriptionId);
    if (read.kind === "ok" && read.value) {
      return { kind: "ok", value: read.value };
    }
    return { kind: "ok", value: { subscriptionId, externalKey, state: "ACTIVE" } };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
};

export const getSubscription = (
  subscriptionId: string,
): Promise<BillingOutcome<KillbillSubscription | null>> =>
  kbRequest<KillbillSubscription>(`/1.0/kb/subscriptions/${subscriptionId}`, { method: "GET" }, 2000).then((r) =>
    r.kind === "ok" && r.value ? { kind: "ok", value: { subscriptionId: r.value.subscriptionId, externalKey: r.value.externalKey, state: r.value.state } } : r,
  );

export const cancelSubscription = (
  subscriptionId: string,
): Promise<BillingOutcome<KillbillSubscription>> =>
  kbRequest<null>(`/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`, {
    method: "DELETE",
  }, 5000).then((r) =>
    r.kind === "ok"
      ? { kind: "ok", value: { subscriptionId, externalKey: "", state: "CANCELLED" } }
      : r,
  );

export const checkReachable = async (timeoutMs: number): Promise<BillingOutcome<null>> => {
  const result = await kbRequest<unknown[]>(`/1.0/kb/pluginsInfo`, { method: "GET" }, timeoutMs);
  return result.kind === "ok" ? { kind: "ok", value: null } : result;
};

