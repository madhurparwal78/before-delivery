// Kill Bill over REST. Billing counts as unreachable on a refused connection, a timeout over 5 seconds or a
// 5xx answer; any 4xx answer is a refusal. Amounts are written as dollars with exactly two decimals.
import { config } from "./config.js";
import { centsToDecimal } from "../shared/money.js";

const { killbill } = config;
const TIMEOUT_MS = 5000;

export class BillingUnreachable extends Error {}
export class BillingRefused extends Error {}

interface Answer {
  status: number;
  text: string;
  location: string | null;
}

async function call(method: string, path: string, body?: string): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(`${killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${killbill.username}:${killbill.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": killbill.apiKey,
        "X-Killbill-ApiSecret": killbill.apiSecret,
        "X-Killbill-CreatedBy": "saltprint-desk",
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnreachable("billing unreachable");
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 500) throw new BillingUnreachable(`billing answered ${response.status}`);
  return { status: response.status, text, location: response.headers.get("location") };
}

function refuse(answer: Answer): never {
  throw new BillingRefused(`billing refused with ${answer.status}`);
}

const json = <T>(answer: Answer): T => JSON.parse(answer.text) as T;

interface Account {
  accountId: string;
  paymentMethodId?: string | null;
}

async function accountByKey(externalKey: string): Promise<Account | null> {
  const answer = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) refuse(answer);
  return json<Account>(answer);
}

/** Finds the account by external key, creating it on first use. */
async function ensureAccount(externalKey: string, name: string): Promise<Account> {
  const found = await accountByKey(externalKey);
  if (found) return found;
  const created = await call("POST", "/accounts", JSON.stringify({ name, externalKey, currency: "USD" }));
  if (created.status !== 201 && created.status !== 409) refuse(created);
  const account = await accountByKey(externalKey);
  if (!account) throw new BillingUnreachable("account not visible yet");
  return account;
}

export const newsroomAccount = (slug: string, name: string): Promise<Account> => ensureAccount(`newsroom-${slug}`, name);

interface Invoice {
  items?: { description?: string | null }[];
}

/**
 * Raises one committed external charge with this description. Before a retry the account is checked for a
 * charge with that description first, so a retry never raises it twice.
 */
export async function raiseCharge(account: Account, description: string, amountCents: number, retry: boolean): Promise<void> {
  if (retry) {
    const invoices = await call("GET", `/accounts/${account.accountId}/invoices?includeInvoiceComponents=true`);
    if (invoices.status !== 200) refuse(invoices);
    const exists = json<Invoice[]>(invoices).some((inv) => (inv.items ?? []).some((i) => i.description === description));
    if (exists) return;
  }
  const body = `[{"accountId":${JSON.stringify(account.accountId)},"description":${JSON.stringify(description)},`
    + `"amount":${centsToDecimal(amountCents)},"currency":"USD","itemType":"EXTERNAL_CHARGE"}]`;
  const charged = await call("POST", `/invoices/charges/${account.accountId}?autoCommit=true`, body);
  if (charged.status !== 201 && charged.status !== 200) refuse(charged);
}

/** Records a payout as a CREDIT payment keyed `payout-<month>-<handle>`, exactly once. */
export async function recordPayout(handle: string, name: string, month: string, amountCents: number): Promise<void> {
  const key = `payout-${month}-${handle}`;
  const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(key)}`);
  if (existing.status === 200) return;
  if (existing.status !== 404) refuse(existing);
  const account = await ensureAccount(`contributor-${handle}`, name);
  if (!account.paymentMethodId) {
    const method = await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ accountId: account.accountId, pluginName: "__EXTERNAL_PAYMENT__" }));
    if (method.status !== 201) refuse(method);
  }
  const body = `{"transactionType":"CREDIT","amount":${centsToDecimal(amountCents)},"currency":"USD",`
    + `"paymentExternalKey":${JSON.stringify(key)},"transactionExternalKey":${JSON.stringify(key)}}`;
  const paid = await call("POST", `/accounts/${account.accountId}/payments`, body);
  if (paid.status !== 201 && paid.status !== 200) refuse(paid);
}
