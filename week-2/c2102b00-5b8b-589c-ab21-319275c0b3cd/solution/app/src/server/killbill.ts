// Kill Bill: household accounts, top-up purchases and cycle-close external charges.
// Every call times out after 5 seconds; an unreachable Kill Bill means payments are paused.
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import type { HouseholdRow as Household } from "./households.js";
import { centsToDecimal, decimalToCents } from "./money.js";

const TIMEOUT_MS = 5000;
const STATUS_TTL_MS = 2000;

const paymentsPaused = () =>
  new ApiError(503, "payments_paused", "Payments are paused. Kill Bill can't be reached right now.");

let lastCheck: { at: number; reachable: boolean } | null = null;

function remember(reachable: boolean): void {
  lastCheck = { at: Date.now(), reachable };
}

interface KbResponse {
  status: number;
  text: string;
  location: string | null;
}

/** Amounts are read as text, never through a floating-point number. */
function parse<T>(text: string): T {
  return JSON.parse(text.replace(/"(amount|processedAmount|balance|creditAdj|refundAdj)"\s*:\s*(-?\d+(?:\.\d+)?)/g, '"$1":"$2"')) as T;
}

async function call(method: string, path: string, body?: string): Promise<KbResponse> {
  const { url, username, password, apiKey, apiSecret } = config.killBill;
  try {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "tally-split",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    remember(response.status < 500);
    if (response.status >= 500) throw paymentsPaused();
    return { status: response.status, text, location: response.headers.get("location") };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    remember(false);
    throw paymentsPaused();
  }
}

/** `available` or `paused`, from a check of Kill Bill made no more than 2 seconds earlier. */
export async function paymentsStatus(): Promise<"available" | "paused"> {
  if (!lastCheck || Date.now() - lastCheck.at > STATUS_TTL_MS) {
    try {
      await call("GET", "/1.0/healthcheck");
    } catch {
      // remembered as unreachable
    }
  }
  return lastCheck?.reachable ? "available" : "paused";
}

function unexpected(what: string, r: KbResponse): never {
  console.error(`kill bill ${what} answered ${r.status}`);
  throw paymentsPaused();
}

interface Account {
  accountId: string;
  paymentMethodId?: string | null;
}

/** Looks the household's account up by external key, creating it only when Kill Bill has none. */
async function ensureAccount(h: Household): Promise<string> {
  const externalKey = `${config.killBill.keyPrefix}-${h.code}`;
  const lookup = () => call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  let found = await lookup();
  if (found.status === 404) {
    const created = await call(
      "POST",
      "/1.0/kb/accounts",
      JSON.stringify({ name: h.name, email: h.email, externalKey, currency: "USD" }),
    );
    if (created.status !== 201 && created.status !== 409) unexpected("account create", created);
    found = await lookup();
  }
  if (found.status !== 200) unexpected("account lookup", found);
  const account = parse<Account>(found.text);
  if (!account.paymentMethodId) {
    const added = await call(
      "POST",
      `/1.0/kb/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__" }),
    );
    if (added.status !== 201) unexpected("payment method", added);
  }
  return account.accountId;
}

interface Payment {
  transactions?: { transactionType: string; status: string; amount: string }[];
}

type Purchase = { state: "confirmed" } | { state: "other-amount" } | { state: "none" };

async function existingPurchase(externalKey: string, cents: number): Promise<Purchase> {
  const found = await call("GET", `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 404) return { state: "none" };
  if (found.status !== 200) unexpected("payment lookup", found);
  const purchases = (parse<Payment>(found.text).transactions ?? []).filter((t) => t.transactionType === "PURCHASE");
  if (purchases.some((t) => decimalToCents(String(t.amount)) !== cents)) return { state: "other-amount" };
  return purchases.some((t) => t.status === "SUCCESS") ? { state: "confirmed" } : { state: "none" };
}

/**
 * A top-up is one PURCHASE whose payment and transaction external keys are `topup-<code>-<key>`.
 * A payment that already landed for the key is confirmed without a second purchase.
 */
export async function purchaseTopUp(h: Household, key: string, cents: number): Promise<"confirmed" | "other-amount"> {
  const externalKey = `topup-${h.code}-${key}`;
  const accountId = await ensureAccount(h);
  const before = await existingPurchase(externalKey, cents);
  if (before.state !== "none") return before.state;
  const body = `{"transactionType":"PURCHASE","amount":${centsToDecimal(cents)},"currency":"USD",${JSON.stringify({
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  }).slice(1)}`;
  const created = await call("POST", `/1.0/kb/accounts/${accountId}/payments`, body);
  if (created.status !== 201) unexpected("purchase", created);
  const after = await existingPurchase(externalKey, cents);
  if (after.state === "none") throw paymentsPaused();
  return after.state;
}

export interface Charge {
  description: string;
  cents: number;
}

interface Invoice {
  items?: { itemType: string; description?: string; amount: string }[];
}

/** External charges already on the account, by description. */
async function postedCharges(accountId: string): Promise<Map<string, number[]>> {
  const found = await call("GET", `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  if (found.status !== 200) unexpected("invoice list", found);
  const posted = new Map<string, number[]>();
  for (const invoice of parse<Invoice[]>(found.text)) {
    for (const item of invoice.items ?? []) {
      if (item.itemType !== "EXTERNAL_CHARGE" || !item.description) continue;
      posted.set(item.description, [...(posted.get(item.description) ?? []), decimalToCents(String(item.amount))]);
    }
  }
  return posted;
}

/** The charges not yet in Kill Bill, or a mismatch when one with the same description differs. */
export async function pendingCharges(h: Household, charges: Charge[]) {
  const accountId = await ensureAccount(h);
  const posted = await postedCharges(accountId);
  const missing: Charge[] = [];
  for (const charge of charges) {
    const amounts = posted.get(charge.description);
    if (!amounts) missing.push(charge);
    else if (!amounts.includes(charge.cents)) return { mismatch: true as const };
  }
  return { mismatch: false as const, accountId, missing };
}

/** Posts a household's missing items together on one invoice. */
export async function postCharges(accountId: string, charges: Charge[]): Promise<void> {
  const items = charges
    .map((c) => `{"accountId":${JSON.stringify(accountId)},"description":${JSON.stringify(c.description)},"amount":${centsToDecimal(c.cents)},"currency":"USD"}`)
    .join(",");
  const posted = await call("POST", `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, `[${items}]`);
  if (posted.status !== 201 && posted.status !== 200) unexpected("charges", posted);
}
