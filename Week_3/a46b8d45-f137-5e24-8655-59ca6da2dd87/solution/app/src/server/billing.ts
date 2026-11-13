import { config } from "./config";
import { fail } from "./errors";
import { asText, isObject, minorToPounds, parseJson, poundsToMinor, type JsonObject } from "./parse";

const TIMEOUT_MS = 15_000;

interface KillBillAnswer {
  status: number;
  body: unknown;
}

async function call(method: string, path: string, body?: unknown): Promise<KillBillAnswer> {
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString("base64")}`,
    "x-killbill-apikey": config.killBill.apiKey,
    "x-killbill-apisecret": config.killBill.apiSecret,
    "x-killbill-createdby": "fittings-desk",
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const response = await fetch(`${config.killBill.url}/1.0/kb${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : parseJson(text) };
  } catch {
    return fail("billing_unavailable");
  }
}

function succeeded(answer: KillBillAnswer): KillBillAnswer {
  return answer.status >= 200 && answer.status < 300 ? answer : fail("billing_unavailable");
}

const objectOf = (value: unknown): JsonObject => (isObject(value) ? value : fail("billing_unavailable"));
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export interface InvoiceReadBack {
  invoiceId: string;
  amountMinor: number;
  balanceMinor: number;
  items: { description: string; amountMinor: number }[];
}

interface TransactionReadBack {
  type: string;
  status: string;
  amountMinor: number;
}

interface PaymentReadBack {
  paymentId: string;
  transactions: TransactionReadBack[];
}

function readInvoice(value: unknown): InvoiceReadBack {
  const invoice = objectOf(value);
  const amountMinor = poundsToMinor(invoice["amount"]);
  const balanceMinor = poundsToMinor(invoice["balance"]);
  const invoiceId = asText(invoice["invoiceId"]);
  if (amountMinor === undefined || balanceMinor === undefined || invoiceId === undefined) return fail("billing_unavailable");
  return {
    invoiceId,
    amountMinor,
    balanceMinor,
    items: listOf(invoice["items"]).map((item) => {
      const entry = objectOf(item);
      return { description: asText(entry["description"]) ?? "", amountMinor: poundsToMinor(entry["amount"]) ?? fail("billing_unavailable") };
    }),
  };
}

function readPayments(value: unknown): PaymentReadBack[] {
  return listOf(value).map((payment) => {
    const entry = objectOf(payment);
    return {
      paymentId: asText(entry["paymentId"]) ?? fail("billing_unavailable"),
      transactions: listOf(entry["transactions"]).map((transaction) => {
        const tx = objectOf(transaction);
        return {
          type: asText(tx["transactionType"]) ?? "",
          status: asText(tx["status"]) ?? "",
          amountMinor: poundsToMinor(tx["amount"]) ?? fail("billing_unavailable"),
        };
      }),
    };
  });
}

const accountLookup = (reference: string): string => `/accounts?externalKey=${encodeURIComponent(reference)}`;

/** One account per claim, named and keyed by the reference only; created at the first quote. */
export async function ensureAccount(reference: string): Promise<string> {
  const found = await call("GET", accountLookup(reference));
  if (found.status === 200) return asText(objectOf(found.body)["accountId"]) ?? fail("billing_unavailable");
  if (found.status !== 404) return fail("billing_unavailable");
  succeeded(await call("POST", "/accounts", { name: reference, externalKey: reference, currency: "GBP" }));
  const created = succeeded(await call("GET", accountLookup(reference)));
  return asText(objectOf(created.body)["accountId"]) ?? fail("billing_unavailable");
}

interface InvoiceCharges {
  partDescription: string;
  partMinor: number;
  carriageDescription: string;
  carriageMinor: number;
}

export async function readInvoiceById(invoiceId: string): Promise<InvoiceReadBack> {
  return readInvoice(succeeded(await call("GET", `/invoices/${invoiceId}?withItems=true`)).body);
}

/** Records one committed invoice with two external charge items and returns what Kill Bill holds for it. */
export async function createInvoice(accountId: string, charges: InvoiceCharges): Promise<InvoiceReadBack> {
  const item = (description: string, minor: number): JsonObject => ({ accountId, description, amount: minorToPounds(minor), currency: "GBP" });
  const created = succeeded(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, [item(charges.partDescription, charges.partMinor), item(charges.carriageDescription, charges.carriageMinor)]));
  const invoiceId = asText(objectOf(listOf(created.body)[0])["invoiceId"]) ?? fail("billing_unavailable");
  return readInvoiceById(invoiceId);
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  succeeded(await call("PUT", `/invoices/${invoiceId}/voidInvoice`));
}

export async function accountPayments(accountId: string): Promise<PaymentReadBack[]> {
  return readPayments(succeeded(await call("GET", `/accounts/${accountId}/payments`)).body);
}

/** Kill Bill's balance for the account, in pence. */
export async function accountBalance(accountId: string): Promise<number> {
  const account = objectOf(succeeded(await call("GET", `/accounts/${accountId}?accountWithBalance=true`)).body);
  return poundsToMinor(account["accountBalance"]) ?? fail("billing_unavailable");
}

export function successfulTransaction(payments: readonly PaymentReadBack[], type: string): { paymentId: string; transaction: TransactionReadBack } {
  for (const payment of payments) {
    const transaction = payment.transactions.find((tx) => tx.type === type && tx.status === "SUCCESS");
    if (transaction) return { paymentId: payment.paymentId, transaction };
  }
  return fail("billing_unavailable");
}

/** Records an external payment of the whole balance and returns the successful PURCHASE amount Kill Bill reports. */
export async function recordExternalPayment(accountId: string, invoiceId: string, balanceMinor: number): Promise<number> {
  succeeded(await call("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, { accountId, purchasedAmount: minorToPounds(balanceMinor) }));
  return successfulTransaction(await accountPayments(accountId), "PURCHASE").transaction.amountMinor;
}

/** Refunds the whole payment and returns the successful REFUND amount Kill Bill reports. */
export async function refundWholePayment(accountId: string, paymentId: string, amountMinor: number): Promise<number> {
  succeeded(await call("POST", `/payments/${paymentId}/refunds`, { amount: minorToPounds(amountMinor) }));
  return successfulTransaction(await accountPayments(accountId), "REFUND").transaction.amountMinor;
}
