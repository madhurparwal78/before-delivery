// Kill Bill: one account per member who has money recorded, and one transaction per money record, each
// written under its own external key and looked up before it is written so that no key is ever used twice.

import { billingAmount } from "../../shared/money.js";
import { config } from "../config.js";

/** Kill Bill could not be reached, timed out or failed; callers answer `billing_unavailable`. */
export class BillingUnavailable extends Error {}

const CALL_TIMEOUT_MS = 4_500;
const EXTERNAL_PAYMENT_PLUGIN = "__EXTERNAL_PAYMENT__";

interface KillBillAccount {
  accountId: string;
  paymentMethodId: string | null;
}

interface KillBillPayment {
  paymentId: string;
  transactions: { transactionExternalKey: string; status: string }[];
}

interface Payer {
  id: string;
  name: string;
  email: string;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "shedline",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`billing ${method} ${path.split("?")[0]} failed: ${(error as Error).name}`);
    throw new BillingUnavailable();
  }
  if (response.status >= 500) {
    console.error(`billing ${method} ${path.split("?")[0]} answered ${response.status}`);
    throw new BillingUnavailable();
  }
  return response;
}

async function json<T>(response: Response, method: string, path: string): Promise<T> {
  if (!response.ok) {
    console.error(`billing ${method} ${path.split("?")[0]} answered ${response.status}`);
    throw new BillingUnavailable();
  }
  return (await response.json()) as T;
}

async function accountByKey(externalKey: string): Promise<KillBillAccount | null> {
  const path = `/accounts?externalKey=${encodeURIComponent(externalKey)}`;
  const response = await call("GET", path);
  if (response.status === 404) return null;
  return json<KillBillAccount>(response, "GET", path);
}

/** The member's account, created on first use with Kill Bill's external payment method as its default. */
async function ensureAccount(payer: Payer): Promise<string> {
  const externalKey = `shedline-${payer.id}`;
  let account = await accountByKey(externalKey);
  if (!account) {
    const created = await call("POST", "/accounts", { name: payer.name, email: payer.email, externalKey, currency: "USD" });
    if (created.status !== 201 && created.status !== 409) await json(created, "POST", "/accounts");
    account = await accountByKey(externalKey);
    if (!account) throw new BillingUnavailable();
  }
  if (!account.paymentMethodId) {
    const path = `/accounts/${account.accountId}/paymentMethods?isDefault=true`;
    const added = await call("POST", path, { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} });
    if (added.status !== 201) await json(added, "POST", path);
  }
  return account.accountId;
}

async function paymentByKey(externalKey: string): Promise<KillBillPayment | null> {
  const path = `/payments?externalKey=${encodeURIComponent(externalKey)}`;
  const response = await call("GET", path);
  if (response.status === 404) return null;
  return json<KillBillPayment>(response, "GET", path);
}

const hasTransaction = (payment: KillBillPayment | null, key: string) =>
  payment?.transactions.some((t) => t.transactionExternalKey === key && t.status === "SUCCESS") ?? false;

async function purchase(payer: Payer, paymentKey: string, transactionKey: string, cents: number): Promise<void> {
  if (hasTransaction(await paymentByKey(paymentKey), transactionKey)) return;
  const accountId = await ensureAccount(payer);
  const path = `/accounts/${accountId}/payments`;
  const response = await call("POST", path, {
    transactionType: "PURCHASE",
    amount: billingAmount(cents),
    currency: "USD",
    paymentExternalKey: paymentKey,
    transactionExternalKey: transactionKey,
  });
  if (response.status !== 201) await json(response, "POST", path);
}

async function refund(paymentKey: string, transactionKey: string, cents: number): Promise<void> {
  const payment = await paymentByKey(paymentKey);
  if (!payment) throw new BillingUnavailable();
  if (hasTransaction(payment, transactionKey)) return;
  const path = `/payments/${payment.paymentId}/refunds`;
  const response = await call("POST", path, { amount: billingAmount(cents), currency: "USD", transactionExternalKey: transactionKey });
  if (response.status !== 201) await json(response, "POST", path);
}

/** The deposit taken at checkout: one PURCHASE on the loan's deposit payment. */
export async function recordDepositHold(payer: Payer, loanId: string, depositCents: number): Promise<void> {
  await purchase(payer, `shedline-${loanId}-deposit`, `shedline-${loanId}-deposit-hold`, depositCents);
}

/** The settlement's billing records; each one only when its amount is above zero. */
export async function recordSettlement(
  payer: Payer,
  loanId: string,
  amounts: { releasedCents: number; extraDamageCents: number; lateFeeCents: number },
): Promise<void> {
  if (amounts.releasedCents > 0) {
    await refund(`shedline-${loanId}-deposit`, `shedline-${loanId}-deposit-release`, amounts.releasedCents);
  }
  if (amounts.extraDamageCents > 0) {
    await purchase(payer, `shedline-${loanId}-extra-damage`, `shedline-${loanId}-extra-damage`, amounts.extraDamageCents);
  }
  if (amounts.lateFeeCents > 0) {
    await purchase(payer, `shedline-${loanId}-late-fee`, `shedline-${loanId}-late-fee`, amounts.lateFeeCents);
  }
}

export async function billingReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}
