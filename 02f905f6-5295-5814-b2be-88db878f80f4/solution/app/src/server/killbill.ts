// Kill Bill: every account, charge, payment and balance.
import { config } from "./config";
import { dollars } from "../shared/money";
import { centsOf } from "./measure";

/** Kill Bill could not be reached (or answered with a server error). */
export class BillingUnavailable extends Error {}
/** Kill Bill answered, but refused or did not complete the request. */
export class BillingRefused extends Error {}

interface KbResponse {
  status: number;
  location: string | null;
  json: unknown;
}

async function kb(method: string, path: string, body?: string): Promise<KbResponse> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "shelfmark",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BillingUnavailable("billing is unreachable");
  }
  const text = await response.text();
  if (response.status >= 500) throw new BillingUnavailable(`billing answered ${response.status}`);
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, location: response.headers.get("location"), json };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function expect(response: KbResponse, ...ok: number[]): KbResponse {
  if (!ok.includes(response.status)) throw new BillingRefused(`billing answered ${response.status}`);
  return response;
}

async function accountIdByKey(externalKey: string): Promise<string | null> {
  const found = await kb("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 404) return null;
  return String(record(expect(found, 200).json).accountId);
}

/** The account with this external key, created (name, email, USD) when missing. */
export async function ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
  const existing = await accountIdByKey(externalKey);
  if (existing) return existing;
  const created = await kb("POST", "/accounts", JSON.stringify({ name, email, externalKey, currency: "USD" }));
  expect(created, 201, 409);
  const id = await accountIdByKey(externalKey);
  if (!id) throw new BillingRefused("account was not created");
  return id;
}

/** Records one external charge (one invoice) and returns the invoice id. */
export async function externalCharge(accountId: string, cents: number, description: string): Promise<string> {
  const body = `[{"amount":${dollars(cents)},"currency":"USD","description":${JSON.stringify(description)}}]`;
  const charged = expect(await kb("POST", `/invoices/charges/${accountId}?autoCommit=true`, body), 201, 200);
  const items = Array.isArray(charged.json) ? charged.json : [];
  const invoiceId = record(items[0]).invoiceId;
  if (typeof invoiceId !== "string") throw new BillingRefused("charge returned no invoice");
  return invoiceId;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  expect(await kb("PUT", `/invoices/${invoiceId}/voidInvoice`), 200, 204);
}

export async function accountBalanceCents(accountId: string): Promise<number> {
  const account = expect(await kb("GET", `/accounts/${accountId}?accountWithBalance=true`), 200);
  return centsOf(record(account.json).accountBalance);
}

/** Every account with its balance, keyed by external key, in one listing. */
export async function balancesByKey(): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = expect(await kb("GET", `/accounts/pagination?offset=${offset}&limit=${pageSize}&accountWithBalance=true`), 200);
    const accounts = Array.isArray(page.json) ? page.json : [];
    for (const account of accounts.map(record)) {
      if (typeof account.externalKey === "string") balances.set(account.externalKey, centsOf(account.accountBalance));
    }
    if (accounts.length < pageSize) return balances;
  }
}

async function successfulPurchase(location: string | null): Promise<number> {
  const paymentId = location ? new URL(location).pathname.replace(/\/+$/, "").split("/").pop() : undefined;
  if (!paymentId) throw new BillingRefused("payment not created");
  const payment = expect(await kb("GET", `/payments/${paymentId}`), 200);
  const transactions = Array.isArray(record(payment.json).transactions) ? (record(payment.json).transactions as unknown[]) : [];
  const purchase = transactions.map(record).find((t) => t.transactionType === "PURCHASE");
  if (!purchase || purchase.status !== "SUCCESS") throw new BillingRefused("purchase did not succeed");
  return centsOf(purchase.amount);
}

export async function invoiceBalanceCents(invoiceId: string): Promise<number> {
  const invoice = expect(await kb("GET", `/invoices/${invoiceId}`), 200);
  return centsOf(record(invoice.json).balance);
}

/** A PURCHASE for an invoice's full balance with Kill Bill's built-in external payment method. */
export async function payInvoice(accountId: string, invoiceId: string, cents: number, paymentKey: string): Promise<number> {
  const body = `{"accountId":"${accountId}","targetInvoiceId":"${invoiceId}","purchasedAmount":${dollars(cents)},"currency":"USD"}`;
  const paid = await kb("POST", `/invoices/${invoiceId}/payments?externalPayment=true&paymentExternalKey=${encodeURIComponent(paymentKey)}`, body);
  expect(paid, 201);
  return successfulPurchase(paid.location);
}

async function externalPaymentMethod(accountId: string): Promise<string> {
  const methods = expect(await kb("GET", `/accounts/${accountId}/paymentMethods`), 200);
  const existing = (Array.isArray(methods.json) ? methods.json : []).map(record).find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
  if (existing && typeof existing.paymentMethodId === "string") return existing.paymentMethodId;
  const created = expect(await kb("POST", `/accounts/${accountId}/paymentMethods`, JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__" })), 201);
  const id = created.location?.replace(/\/+$/, "").split("/").pop();
  if (!id) throw new BillingRefused("payment method not created");
  return id;
}

/**
 * A member's counter payment: one PURCHASE for the whole balance, then the same amount applied as
 * account credit so it settles every open invoice at once.
 */
export async function payAccountBalance(accountId: string, cents: number, paymentKey: string): Promise<number> {
  const method = await externalPaymentMethod(accountId);
  const body = `{"transactionType":"PURCHASE","amount":${dollars(cents)},"currency":"USD","paymentExternalKey":${JSON.stringify(paymentKey)}}`;
  const paid = await kb("POST", `/accounts/${accountId}/payments?paymentMethodId=${method}`, body);
  expect(paid, 201);
  const amount = await successfulPurchase(paid.location);
  const credit = `[{"accountId":"${accountId}","amount":${dollars(amount)},"currency":"USD","description":"Counter payment ${paymentKey}"}]`;
  expect(await kb("POST", "/credits?autoCommit=true", credit), 200, 201);
  return amount;
}
