import { config } from "../config.js";
import { fail } from "../http.js";

const TIMEOUT_MS = 10_000;

interface Transaction {
  transactionType: string;
  transactionExternalKey: string;
  status: string;
  amount: number;
}

interface Payment {
  paymentId: string;
  accountId: string;
  transactions: Transaction[];
}

interface Account {
  accountId: string;
  paymentMethodId: string | null;
}

const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");

/** One Kill Bill call. Refused connections, timeouts and 5xx answers are the billing outage. */
async function call(method: string, path: string, body?: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "lanternfish",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw fail(503, "billing_unavailable");
  }
  if (response.status >= 500) throw fail(503, "billing_unavailable");
  return response;
}

async function found<T>(response: Response): Promise<T | null> {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kill Bill answered ${response.status}: ${await response.text()}`);
  return JSON.parse(await response.text());
}

async function created(response: Response): Promise<void> {
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Kill Bill answered ${response.status}: ${await response.text()}`);
  }
}

function dollars(priceCents: number): number {
  return priceCents / 100;
}

/**
 * The one account keyed by the enrolment id, whoever created it. It is created only when Kill Bill has none
 * (a simultaneous creation by another process is reused), and given the external payment method if it has no default.
 */
async function accountFor(enrollment: { id: string; name: string; email: string }): Promise<Account> {
  const query = `/accounts?externalKey=${encodeURIComponent(enrollment.id)}`;
  let account = await found<Account>(await call("GET", query));
  if (!account) {
    const response = await call("POST", "/accounts", { externalKey: enrollment.id, name: enrollment.name, email: enrollment.email, currency: "USD" });
    if (response.status !== 409) await created(response);
    account = await found<Account>(await call("GET", query));
    if (!account) throw new Error("Kill Bill has no account for the enrolment after creating it");
  }
  if (account.paymentMethodId === null) {
    await created(
      await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, {
        pluginName: "__EXTERNAL_PAYMENT__",
        pluginInfo: { properties: [] },
      }),
    );
  }
  return account;
}

async function paymentByKey(externalKey: string): Promise<Payment | null> {
  return found<Payment>(await call("GET", `/payments?externalKey=${encodeURIComponent(externalKey)}`));
}

function success(payment: Payment | null, type: "PURCHASE" | "REFUND"): Transaction | undefined {
  return payment?.transactions.find((t) => t.transactionType === type && t.status === "SUCCESS");
}

type ChargeResult = { charged: true; paymentId: string; amountCents: number } | { charged: false };

/** Charges the seat once: an existing successful PURCHASE under the enrolment's key is reused, never repeated. */
export async function chargeSeat(enrollment: { id: string; name: string; email: string; priceCents: number }): Promise<ChargeResult> {
  const account = await accountFor(enrollment);
  let payment = await paymentByKey(enrollment.id);
  if (!success(payment, "PURCHASE")) {
    // With only unsuccessful PURCHASEs on record, the same payment external key retries on that payment.
    const response = await call("POST", `/accounts/${account.accountId}/payments`, {
      transactionType: "PURCHASE",
      amount: dollars(enrollment.priceCents),
      currency: "USD",
      paymentExternalKey: enrollment.id,
      transactionExternalKey: `${enrollment.id}-purchase`,
    });
    if (response.status >= 400) return { charged: false };
    payment = await paymentByKey(enrollment.id);
  }
  const purchase = success(payment, "PURCHASE");
  return payment && purchase ? { charged: true, paymentId: payment.paymentId, amountCents: Math.round(purchase.amount * 100) } : { charged: false };
}

/** Records one full REFUND on the seat's payment; true only when Kill Bill reports it SUCCESS. */
export async function refundSeat(enrollment: { id: string; paymentId: string; priceCents: number }): Promise<boolean> {
  if (!success(await paymentByKey(enrollment.id), "REFUND")) {
    const response = await call("POST", `/payments/${enrollment.paymentId}/refunds`, {
      amount: dollars(enrollment.priceCents),
      currency: "USD",
      transactionExternalKey: `${enrollment.id}-refund`,
    });
    if (response.status >= 400) return false;
  }
  return success(await paymentByKey(enrollment.id), "REFUND") !== undefined;
}
