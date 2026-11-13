import { randomUUID } from "node:crypto";
import { PROVIDER_TIMEOUT_MS, config } from "./config.js";
import { dollars } from "./money.js";

// Kill Bill records every entry-fee invoice, payment and refund (brief: Services, Kill Bill).

export class BillingUnavailable extends Error {}

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const auth = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function call(method: string, path: string, body?: unknown, ...ok: number[]): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: auth,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "cutline-jury-desk",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailable(`Kill Bill ${method} ${path} unreachable`);
  }
  if (!ok.includes(response.status)) {
    throw new BillingUnavailable(`Kill Bill ${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Account {
  accountId: string;
  paymentMethodId: string | null;
}

export interface Studio {
  id: string;
  name: string;
  email: string;
}

/** One account per studio, created at its first payment attempt that reaches billing. */
async function studioAccount(studio: Studio): Promise<string> {
  const externalKey = `cutline-studio-${studio.id}`;
  const lookup = async () => {
    const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, 200, 404);
    return found.status === 200 ? json<Account>(found) : null;
  };
  let account = await lookup();
  if (!account) {
    const created = await createAccount(studio, externalKey);
    account = created ?? (await lookup());
    if (!account) throw new BillingUnavailable("Kill Bill account could not be read back");
  }
  if (!account.paymentMethodId) {
    await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      { pluginName: "__EXTERNAL_PAYMENT__" }, 201);
    // Invoices are paid by the desk with the entry's payment key, never by Kill Bill's automatic retry.
    await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF], 201);
  }
  return account.accountId;
}

async function createAccount(studio: Studio, externalKey: string): Promise<Account | null> {
  const response = await call("POST", "/accounts",
    { name: studio.name, email: studio.email, currency: "USD", externalKey }, 201, 400, 409);
  if (response.status !== 201) return null;
  const id = response.headers.get("location")?.split("/").filter(Boolean).pop();
  return id ? { accountId: id, paymentMethodId: null } : null;
}

interface Charge {
  invoiceId: string;
  invoiceItemId: string;
  paymentId: string;
}

/** One invoice with one external charge, paid by one PURCHASE keyed `cutline-entry-<entry id>`. */
export async function chargeEntryFee(studio: Studio, entryId: string, description: string, amountCents: number): Promise<Charge> {
  const accountId = await studioAccount(studio);
  const [item] = await json<{ invoiceId: string; invoiceItemId: string }[]>(await call("POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    [{ accountId, amount: dollars(amountCents), currency: "USD", description }], 200, 201));
  if (!item) throw new BillingUnavailable("Kill Bill returned no invoice item");
  try {
    const paid = await call("POST", `/invoices/${item.invoiceId}/payments?externalPayment=false`,
      { accountId, purchasedAmount: dollars(amountCents), paymentExternalKey: await paymentKey(entryId) }, 201);
    const paymentId = paid.headers.get("location")?.split("/").filter(Boolean).pop();
    if (!paymentId) throw new BillingUnavailable("Kill Bill returned no payment id");
    return { invoiceId: item.invoiceId, invoiceItemId: item.invoiceItemId, paymentId };
  } catch (error) {
    await adjustToZero(accountId, item.invoiceId, item.invoiceItemId, amountCents);
    throw error;
  }
}

/**
 * `cutline-entry-<entry id>`. The receipt's SMTP session is open before any charge, so Kill Bill holds the key already
 * only when the mail server refused a receipt after accepting its recipient and the payment was refunded; Kill Bill
 * allows no second PURCHASE on that payment, so the retry's payment takes the key with an attempt suffix.
 */
async function paymentKey(entryId: string): Promise<string> {
  const key = `cutline-entry-${entryId}`;
  const earlier = await call("GET", `/payments?externalKey=${encodeURIComponent(key)}`, undefined, 200, 404);
  return earlier.status === 404 ? key : `${key}-attempt-${randomUUID().slice(0, 8)}`;
}

/** An unpaid invoice left by a failed attempt is adjusted to zero so nothing stays owed. */
async function adjustToZero(accountId: string, invoiceId: string, invoiceItemId: string, amountCents: number): Promise<void> {
  await call("POST", `/invoices/${invoiceId}`,
    { accountId, invoiceId, invoiceItemId, amount: dollars(amountCents), currency: "USD" }, 201);
}

/** A REFUND for the full fee on the same payment, adjusting the invoice so the account balance returns to zero. */
export async function refundEntryFee(paymentId: string, invoiceItemId: string, amountCents: number): Promise<void> {
  await call("POST", `/invoicePayments/${paymentId}/refunds`, {
    amount: dollars(amountCents),
    isAdjusted: true,
    adjustments: [{ invoiceItemId, amount: dollars(amountCents), currency: "USD" }],
  }, 201);
}
