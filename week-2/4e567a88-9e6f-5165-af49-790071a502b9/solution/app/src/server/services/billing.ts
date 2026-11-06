// Kill Bill: one account per team (external key = team id), one committed external-charge invoice per
// top-up, paid in full by one PURCHASE through the account's external payment method. Every step looks
// for what an earlier, interrupted attempt already recorded (a timed-out call may have been carried out),
// so a retry never creates a second invoice or pays one twice.

import { config } from "../config";
import { serviceRequest, type ServiceAnswer } from "./serviceHttp";

const { url, username, password, apiKey, apiSecret } = config.billing;
const TIMEOUT_MS = 10_000;

/** No connection, a timeout over 10 seconds, or a 5xx answer. */
export class BillingUnavailable extends Error {}
/** A 4xx refusal. */
export class BillingRejected extends Error {}

const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let answer: ServiceAnswer;
  try {
    answer = await serviceRequest(`${url}/1.0/kb${path}`, method, {
      authorization,
      "X-Killbill-ApiKey": apiKey,
      "X-Killbill-ApiSecret": apiSecret,
      "X-Killbill-CreatedBy": "lumenfold-dispatch",
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Length": String(payload === undefined ? 0 : Buffer.byteLength(payload)),
    }, payload, TIMEOUT_MS);
  } catch {
    throw new BillingUnavailable("Kill Bill did not answer");
  }
  if (answer.status >= 500) throw new BillingUnavailable(`Kill Bill answered ${answer.status}`);
  const text = answer.body.toString("utf8");
  return { status: answer.status, data: text ? (JSON.parse(text) as unknown) : null };
}

function expectOk(result: { status: number }, what: string): void {
  if (result.status >= 400) throw new BillingRejected(`Kill Bill refused ${what} (${result.status})`);
}

interface KbAccount { accountId: string }
interface KbInvoiceItem { invoiceId: string; description: string | null }
interface KbInvoice { invoiceId: string; items: KbInvoiceItem[] }
interface KbTransaction { transactionType: string; status: string }
interface KbPayment { paymentId: string; transactions: KbTransaction[] }

async function findAccount(teamId: string): Promise<string | null> {
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(teamId)}`);
  if (found.status === 404) return null;
  expectOk(found, "the account lookup");
  return (found.data as KbAccount).accountId;
}

/** The team's account, created with an external payment method at the team's first top-up. */
async function ensureAccount(teamId: string, teamName: string): Promise<string> {
  let accountId = await findAccount(teamId);
  if (!accountId) {
    const made = await call("POST", "/accounts", { name: teamName, externalKey: teamId, currency: "USD" });
    if (made.status !== 409) expectOk(made, "the new account");
    accountId = await findAccount(teamId);
    if (!accountId) throw new BillingRejected("Kill Bill did not keep the new account");
  }
  const methods = await call("GET", `/accounts/${accountId}/paymentMethods`);
  expectOk(methods, "the payment method lookup");
  if (!(methods.data as unknown[]).length) {
    expectOk(await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`,
      { pluginName: "__EXTERNAL_PAYMENT__", isDefault: true }), "the external payment method");
  }
  return accountId;
}

/** Top-up ids never repeat across instances, so the description names exactly one invoice. */
const chargeDescription = (topupId: string): string => `Dispatch credits ${topupId}`;

async function findInvoice(accountId: string, topupId: string): Promise<string | null> {
  const listed = await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  expectOk(listed, "the invoice lookup");
  const invoice = (listed.data as KbInvoice[]).find((i) => i.items.some((item) => item.description === chargeDescription(topupId)));
  return invoice?.invoiceId ?? null;
}

async function ensureInvoice(accountId: string, topup: TopupCharge): Promise<string> {
  const existing = await findInvoice(accountId, topup.id);
  if (existing) return existing;
  const made = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, [{
    amount: topup.amount_usd, currency: "USD", description: chargeDescription(topup.id),
  }]);
  expectOk(made, "the invoice");
  return (made.data as KbInvoiceItem[])[0].invoiceId;
}

const succeeded = (payment: KbPayment): boolean =>
  payment.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");

async function findPayment(invoiceId: string): Promise<string | null> {
  const listed = await call("GET", `/invoices/${invoiceId}/payments`);
  expectOk(listed, "the payment lookup");
  return (listed.data as KbPayment[]).find(succeeded)?.paymentId ?? null;
}

export interface PaidTopup {
  accountId: string;
  invoiceId: string;
  paymentId: string;
}

/**
 * Records the paid top-up in Kill Bill. `progress` stores each id as soon as it exists so a retry resumes
 * where an outage interrupted it.
 */
interface TopupCharge {
  id: string;
  team_id: string;
  team_name: string;
  amount_usd: string;
}

export async function recordTopup(
  topup: TopupCharge,
  progress: (ids: Partial<PaidTopup>) => Promise<void>,
): Promise<PaidTopup> {
  const accountId = await ensureAccount(topup.team_id, topup.team_name);
  await progress({ accountId });
  const invoiceId = await ensureInvoice(accountId, topup);
  await progress({ invoiceId });
  let paymentId = await findPayment(invoiceId);
  if (!paymentId) {
    expectOk(await call("POST", `/invoices/${invoiceId}/payments?externalPayment=true`,
      { accountId, targetInvoiceId: invoiceId, purchasedAmount: topup.amount_usd, currency: "USD" }), "the payment");
    paymentId = await findPayment(invoiceId);
    if (!paymentId) throw new BillingRejected("Kill Bill did not record a successful payment");
  }
  return { accountId, invoiceId, paymentId };
}

/**
 * True when the billing API answers a lookup by the same rule top-ups use: no connection, a timeout or a
 * 5xx is down (Kill Bill's own health endpoint also reports internal queue lag, which is not an outage).
 */
export async function checkBilling(): Promise<boolean> {
  try {
    await call("GET", "/accounts?externalKey=lumenfold-dispatch-status-check");
    return true;
  } catch (error) {
    return !(error instanceof BillingUnavailable);
  }
}
