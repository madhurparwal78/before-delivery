// Kill Bill takes and refunds deposits. A deposit is one PURCHASE per reference, a refund one REFUND.
import { formatEuros } from "../shared/euros.js";
import { config } from "./config.js";
import { recordDeposits } from "./dependencies.js";
import { apiErrors } from "./errors.js";

const CALL_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_500;
const EXTERNAL_PAYMENT_METHOD = "__EXTERNAL_PAYMENT__";

const credentials = Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString("base64");
const headers = {
  Authorization: `Basic ${credentials}`,
  "X-Killbill-ApiKey": config.killBill.apiKey,
  "X-Killbill-ApiSecret": config.killBill.apiSecret,
  "X-Killbill-CreatedBy": "saffron-slate-tables",
  "Content-Type": "application/json",
  Accept: "application/json",
};

interface Reply {
  status: number;
  json: unknown;
}

/** A call that is refused or takes longer than 10 seconds means Kill Bill is unreachable. */
async function call(method: string, path: string, body?: unknown): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${config.killBill.url}/1.0/kb${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    recordDeposits(false);
    throw apiErrors.depositsPaused();
  }
  if (response.status >= 500) {
    recordDeposits(false);
    throw apiErrors.depositsPaused();
  }
  recordDeposits(true);
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
}

/** Kill Bill answers when it responds at all; its own healthcheck can fail on an idle queue, so it is not used. */
export async function probeKillBill(): Promise<void> {
  const response = await fetch(`${config.killBill.url}/1.0/kb/tenants?apiKey=${encodeURIComponent(config.killBill.apiKey)}`, {
    headers,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (response.status >= 500) throw new Error("Kill Bill is failing");
}

interface Account {
  accountId: string;
  paymentMethodId: string | null;
}

interface Transaction {
  transactionType: string;
  transactionExternalKey: string;
  status: string;
  transactionId: string;
}

interface Payment {
  paymentId: string;
  accountId: string;
  transactions: Transaction[];
}

export interface Settled {
  accountId: string;
  paymentId: string;
  transactionId: string;
}

async function findAccount(externalKey: string): Promise<Account | null> {
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  return found.status === 200 ? (found.json as Account) : null;
}

/** Each lowercased email is one account, in EUR, paid through the built-in external method. */
async function ensureAccount(name: string, email: string): Promise<string> {
  const externalKey = email.toLowerCase();
  let account = await findAccount(externalKey);
  if (account === null) {
    await call("POST", "/accounts", { name, email, externalKey, currency: "EUR" });
    account = await findAccount(externalKey);
  }
  if (account === null) throw apiErrors.depositsPaused();
  if (account.paymentMethodId === null) {
    const method = await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, {
      pluginName: EXTERNAL_PAYMENT_METHOD,
      pluginInfo: { properties: [] },
    });
    if (method.status >= 400) throw apiErrors.depositsPaused();
  }
  return account.accountId;
}

async function paymentByKey(reference: string): Promise<Payment | null> {
  const found = await call("GET", `/payments?externalKey=${encodeURIComponent(reference)}`);
  return found.status === 200 ? (found.json as Payment) : null;
}

function succeeded(payment: Payment | null, type: string, externalKey: string): Transaction | undefined {
  return payment?.transactions.find(
    (transaction) =>
      transaction.transactionType === type && transaction.transactionExternalKey === externalKey && transaction.status === "SUCCESS",
  );
}

/** Charges the deposit once; continues only once Kill Bill reports the PURCHASE as successful. */
export async function purchaseDeposit(reference: string, name: string, email: string, cents: number): Promise<Settled> {
  const externalKey = `${reference}-deposit`;
  const earlier = succeeded(await paymentByKey(reference), "PURCHASE", externalKey);
  const accountId = await ensureAccount(name, email);
  if (earlier !== undefined) {
    return { accountId, paymentId: (await paymentByKey(reference))?.paymentId ?? "", transactionId: earlier.transactionId };
  }
  const attempt = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "PURCHASE",
    amount: formatEuros(cents),
    currency: "EUR",
    paymentExternalKey: reference,
    transactionExternalKey: externalKey,
  });
  if (attempt.status >= 400) throw apiErrors.paymentFailed();
  const payment = await paymentByKey(reference);
  const purchase = succeeded(payment, "PURCHASE", externalKey);
  if (payment === null || purchase === undefined) throw apiErrors.paymentFailed();
  return { accountId, paymentId: payment.paymentId, transactionId: purchase.transactionId };
}

/** Refunds the full deposit once; the answer waits for Kill Bill to record the REFUND as successful. */
export async function refundDeposit(reference: string, paymentId: string, cents: number): Promise<string> {
  const externalKey = `${reference}-refund`;
  const earlier = succeeded(await paymentByKey(reference), "REFUND", externalKey);
  if (earlier !== undefined) return earlier.transactionId;
  const attempt = await call("POST", `/payments/${paymentId}/refunds`, {
    amount: formatEuros(cents),
    transactionExternalKey: externalKey,
  });
  const refund = succeeded(attempt.status < 400 ? await paymentByKey(reference) : null, "REFUND", externalKey);
  if (refund === undefined) throw apiErrors.depositsPaused();
  return refund.transactionId;
}
