// Kill Bill: one account and one monthly subscription per contract, payments, refunds and confirmed cancellation.
// Every charge and refund is looked up by its published external key first and adopted when it already exists.

import { config } from "../config.js";
import { billingUnavailable, idempotencyConflict } from "../http/errors.js";
import { parseDollars, plainDollars } from "../../shared/money.js";

const PLAN = "bellroll-rental-monthly";
const { url, username, password, apiKey, apiSecret } = config.killBill;

interface KbTransaction { transactionType: string; transactionExternalKey: string; amount: number; status: string; transactionId: string }
interface KbPayment { paymentId: string; transactions: KbTransaction[] }
interface KbAccount { accountId: string; paymentMethodId: string | null }
interface KbSubscription { subscriptionId: string; externalKey: string; state: string }

const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

let tenantReady: Promise<void> | null = null;

/** Creates the tenant for KILLBILL_API_KEY once when Kill Bill has none; retried on the next call after a failure. */
export function ensureTenant(): Promise<void> {
  const tenantRequest = (method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${url}/1.0/kb/tenants${path}`, { method, body, signal: AbortSignal.timeout(20_000), headers: {
      authorization, "x-killbill-createdby": "bellroll", accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }) } });
  // Kill Bill answers an unknown API key with an error status (500 from its tenant cache), not always 404.
  const exists = async (): Promise<boolean> =>
    (await tenantRequest("GET", `?apiKey=${encodeURIComponent(apiKey)}`)).status === 200;
  tenantReady ??= (async () => {
    if (await exists()) return;
    await tenantRequest("POST", "", JSON.stringify({ apiKey, apiSecret }));
    if (!(await exists())) throw billingUnavailable();
  })().catch(() => {
    tenantReady = null;
    throw billingUnavailable();
  });
  return tenantReady;
}

async function call(method: string, path: string, body?: string): Promise<Response> {
  await ensureTenant();
  try {
    const response = await fetch(`${url}/1.0/kb${path}`, {
      method, body, signal: AbortSignal.timeout(20_000),
      headers: {
        authorization, "x-killbill-apikey": apiKey, "x-killbill-apisecret": apiSecret, "x-killbill-createdby": "bellroll",
        accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    });
    if (response.status >= 300 && response.status !== 404) throw billingUnavailable();
    return response;
  } catch {
    throw billingUnavailable();
  }
}

async function read<T>(path: string): Promise<T | null> {
  const response = await call("GET", path);
  return response.status === 404 ? null : (await response.json()) as T;
}

/** Kill Bill reports amounts as JSON numbers with at most two decimals; read them back as exact cents. */
function centsOf(amount: number): number {
  const cents = parseDollars(String(amount));
  if (cents === null) throw billingUnavailable();
  return cents;
}

let catalogReady: Promise<void> | null = null;

/** Uploads the $0.00 monthly rental plan to the tenant's catalog when it is missing. */
function ensureCatalog(): Promise<void> {
  const hasPlan = async (): Promise<boolean> => JSON.stringify(await read<unknown[]>("/catalog")).includes(`"${PLAN}"`);
  catalogReady ??= (async () => {
    if (await hasPlan()) return;
    // Another instance may upload the same plan at the same moment; the read-back decides.
    await call("POST", "/catalog/simplePlan", JSON.stringify({ planId: PLAN, productName: "Rental",
      productCategory: "BASE", currency: "USD", amount: 0, billingPeriod: "MONTHLY", trialLength: 0,
      trialTimeUnit: "UNLIMITED" })).catch(() => undefined);
    if (!(await hasPlan())) throw billingUnavailable();
  })().catch((error: unknown) => {
    catalogReady = null;
    throw error;
  });
  return catalogReady;
}

export interface AccountHolder { contractId: string; parentName: string; parentEmail: string }

/** The contract's account, looked up by external key first; created (with an external payment method) if missing. */
export async function ensureAccount(holder: AccountHolder): Promise<string> {
  const path = `/accounts?externalKey=${encodeURIComponent(holder.contractId)}`;
  let account = await read<KbAccount>(path);
  if (account === null) {
    await call("POST", "/accounts", JSON.stringify({ name: holder.parentName, email: holder.parentEmail,
      externalKey: holder.contractId, currency: "USD" }));
    account = await read<KbAccount>(path);
    if (account === null) throw billingUnavailable();
  }
  if (account.paymentMethodId === null) {
    await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__" }));
  }
  return account.accountId;
}

async function findSubscription(accountId: string, externalKey: string): Promise<KbSubscription | null> {
  const bundles = await read<{ subscriptions: KbSubscription[] }[]>(`/accounts/${accountId}/bundles`);
  return (bundles ?? []).flatMap((b) => b.subscriptions).find((s) => s.externalKey === externalKey) ?? null;
}

/** The contract's monthly subscription, created on its account when missing. */
export async function ensureSubscription(accountId: string, contractId: string): Promise<KbSubscription> {
  const externalKey = `${contractId}-rental`;
  const existing = await findSubscription(accountId, externalKey);
  if (existing) return existing;
  await ensureCatalog();
  await call("POST", "/subscriptions", JSON.stringify({ accountId, externalKey, bundleExternalKey: externalKey,
    planName: PLAN }));
  const created = await findSubscription(accountId, externalKey);
  if (created === null) throw billingUnavailable();
  return created;
}

/**
 * Cancels the subscription with immediate entitlement and billing policies (unless it is already cancelled) and
 * reads it back; anything but CANCELLED is a billing failure.
 */
export async function cancelSubscriptionConfirmed(subscription: KbSubscription): Promise<void> {
  if (subscription.state !== "CANCELLED") {
    await call("DELETE", `/subscriptions/${subscription.subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`);
  }
  const readBack = await read<KbSubscription>(`/subscriptions/${subscription.subscriptionId}`);
  if (readBack?.state !== "CANCELLED") throw billingUnavailable();
}

async function paymentByKey(externalKey: string): Promise<KbPayment | null> {
  return read<KbPayment>(`/payments?externalKey=${encodeURIComponent(externalKey)}`);
}

/**
 * One PURCHASE under `externalKey` (used as both payment and transaction key). An existing successful purchase of
 * the same amount is adopted; one of a different amount is an idempotency conflict. Returns the Kill Bill payment ID.
 */
export async function purchaseOnce(accountId: string, externalKey: string, cents: number): Promise<string> {
  const existing = await paymentByKey(externalKey);
  if (existing) {
    const purchase = existing.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
    if (purchase && centsOf(purchase.amount) === cents) return existing.paymentId;
    throw idempotencyConflict();
  }
  await call("POST", `/accounts/${accountId}/payments`, `{"transactionType":"PURCHASE","amount":${plainDollars(cents)},"currency":"USD","paymentExternalKey":${JSON.stringify(externalKey)},"transactionExternalKey":${JSON.stringify(externalKey)}}`);
  const made = await paymentByKey(externalKey);
  const purchase = made?.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
  if (!made || !purchase) throw billingUnavailable();
  return made.paymentId;
}

/**
 * One REFUND of `cents` on the original payment under `transactionKey`, adopting an existing successful refund of
 * the same amount. Returns the refund's transaction ID.
 */
export async function refundOnce(paymentId: string, transactionKey: string, cents: number): Promise<string> {
  const refundOf = (payment: KbPayment | null): KbTransaction | undefined =>
    payment?.transactions.find((t) => t.transactionType === "REFUND" && t.transactionExternalKey === transactionKey);
  const existing = refundOf(await read<KbPayment>(`/payments/${paymentId}`));
  if (existing) {
    if (existing.status === "SUCCESS" && centsOf(existing.amount) === cents) return existing.transactionId;
    throw idempotencyConflict();
  }
  await call("POST", `/payments/${paymentId}/refunds`, `{"amount":${plainDollars(cents)},"currency":"USD","transactionExternalKey":${JSON.stringify(transactionKey)}}`);
  const made = refundOf(await read<KbPayment>(`/payments/${paymentId}`));
  if (made?.status !== "SUCCESS") throw billingUnavailable();
  return made.transactionId;
}
