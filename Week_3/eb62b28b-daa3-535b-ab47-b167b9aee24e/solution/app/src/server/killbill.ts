// The Kill Bill client: real HTTP calls on the tenant the environment names.

import { randomInt } from "node:crypto";
import { z } from "zod";
import { Cadence } from "../shared/api";
import { localDate, wholeSeconds } from "../shared/time";
import { config } from "./config";
import { amountText, centsFromAmount } from "./decimal";
import { HttpFailure, payments503 } from "./errors";
import { PLUS_CENTS } from "./prices";

const API = `${config.killBill.url}/1.0/kb`;
const REQUEST_WAIT_MS = 6000;
const SECONDS_IN_A_DAY = 86400;
const PAID_BY_EXTERNAL_METHOD = "__EXTERNAL_PAYMENT__";

const headers: Record<string, string> = {
  Authorization: `Basic ${Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString("base64")}`,
  "X-Killbill-ApiKey": config.killBill.apiKey,
  "X-Killbill-ApiSecret": config.killBill.apiSecret,
  "X-Killbill-CreatedBy": "ocotillo-member-desk",
};

const PLAN_OF: Record<Cadence, string> = { sixMonths: "plus-six-months", yearly: "plus-yearly" };

export function cadenceOfPlan(planName: string): Cadence {
  return planName === PLAN_OF.yearly ? "yearly" : "sixMonths";
}

// Copies sharing one tenant can upload at the same moment, and Kill Bill can no longer read two versions with one
// effective date. Each upload takes its own second of the day before it, so a race only leaves equal versions.
function catalogXml(now: Date): string {
  const effectiveDate = wholeSeconds(new Date(now.getTime() - (SECONDS_IN_A_DAY + randomInt(SECONDS_IN_A_DAY)) * 1000));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effectiveDate}</effectiveDate>
  <catalogName>ocotillo</catalogName>
  <currencies><currency>USD</currency></currencies>
  <products><product name="Plus"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>
    <plan name="${PLAN_OF.sixMonths}"><product>Plus</product><recurringBillingMode>IN_ADVANCE</recurringBillingMode>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>BIANNUAL</billingPeriod><recurringPrice><price><currency>USD</currency><value>${amountText(PLUS_CENTS.sixMonths)}</value></price></recurringPrice></recurring>
      </finalPhase></plan>
    <plan name="${PLAN_OF.yearly}"><product>Plus</product><recurringBillingMode>IN_ADVANCE</recurringBillingMode>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>ANNUAL</billingPeriod><recurringPrice><price><currency>USD</currency><value>${amountText(PLUS_CENTS.yearly)}</value></price></recurringPrice></recurring>
      </finalPhase></plan>
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans><plan>${PLAN_OF.sixMonths}</plan><plan>${PLAN_OF.yearly}</plan></plans></defaultPriceList></priceLists>
</catalog>`;
}

interface Call {
  method?: string;
  body?: string;
  contentType?: string;
}

// Unreachable or a server error is the one published payments outage.
async function send(path: string, call: Call = {}): Promise<Response> {
  let answer: Response;
  try {
    answer = await fetch(`${API}${path}`, {
      method: call.method ?? "GET",
      headers: { ...headers, ...(call.body === undefined ? {} : { "Content-Type": call.contentType ?? "application/json" }) },
      ...(call.body === undefined ? {} : { body: call.body }),
      signal: AbortSignal.timeout(REQUEST_WAIT_MS),
    });
  } catch {
    throw payments503();
  }
  if (answer.status >= 500) throw payments503();
  return answer;
}

async function sendOk(path: string, call: Call = {}): Promise<Response> {
  const answer = await send(path, call);
  if (!answer.ok) throw new HttpFailure(`Kill Bill ${call.method ?? "GET"} ${path}: ${answer.status} ${await answer.text()}`);
  return answer;
}

function lastPathPiece(answer: Response): string {
  const location = answer.headers.get("Location") ?? "";
  const id = location.split("/").at(-1);
  if (!id) throw new HttpFailure("Kill Bill answered without a Location");
  return id;
}

export async function uploadCatalogIfMissing(): Promise<void> {
  const known = async (): Promise<boolean> => {
    const catalogs = z.array(z.object({ products: z.array(z.object({ name: z.string() })) }))
      .parse(await (await sendOk("/catalog")).json());
    return catalogs.some((catalog) => catalog.products.some((product) => product.name === "Plus"));
  };
  if (await known()) return;
  const uploaded = await send("/catalog/xml", { method: "POST", body: catalogXml(new Date()), contentType: "text/xml" });
  // Copies start together: another one may have uploaded first, which also leaves the tenant with the catalog.
  if (!uploaded.ok && !(await known())) throw new HttpFailure(`Kill Bill catalog upload: ${uploaded.status}`);
}

const Account = z.object({ accountId: z.string(), paymentMethodId: z.string().nullish() });

// The end-of-term instant falls at this time of day, noon in Phoenix, so it reads the same date in every zone.
function noonInPhoenix(now: Date): string {
  return `${localDate(now, "phoenix")}T19:00:00.000Z`;
}

// Safe to repeat: a retry after a lost answer finds the account and finishes what is missing, so invoices are paid at once.
export async function ensureAccount(memberId: string, name: string, email: string, now: Date): Promise<string> {
  const existing = await send(`/accounts?externalKey=${encodeURIComponent(memberId)}`);
  const account = existing.ok ? Account.parse(await existing.json()) : null;
  const accountId = account?.accountId ?? lastPathPiece(await sendOk("/accounts", {
    method: "POST",
    body: JSON.stringify({
      externalKey: memberId,
      name,
      email,
      currency: "USD",
      timeZone: "America/Phoenix",
      referenceTime: noonInPhoenix(now),
    }),
  }));
  if (!account?.paymentMethodId) {
    await sendOk(`/accounts/${accountId}/paymentMethods?isDefault=true`, {
      method: "POST",
      body: JSON.stringify({ externalKey: `${memberId}-payment`, pluginName: PAID_BY_EXTERNAL_METHOD, isDefault: true }),
    });
  }
  return accountId;
}

const Bundles = z.array(z.object({
  subscriptions: z.array(z.object({
    subscriptionId: z.string(),
    state: z.string().nullish(),
    cancelledDate: z.string().nullish(),
  })),
}));

// One subscription per join: a retry after a lost answer finds the one already running.
export async function ensureSubscription(accountId: string, cadence: Cadence): Promise<string> {
  const bundles = Bundles.parse(await (await sendOk(`/accounts/${accountId}/bundles`)).json());
  const running = bundles
    .flatMap((bundle) => bundle.subscriptions)
    .find((subscription) => subscription.state === "ACTIVE" && !subscription.cancelledDate);
  if (running) return running.subscriptionId;
  const created = await sendOk("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ accountId, planName: PLAN_OF[cadence] }),
  });
  return lastPathPiece(created);
}

const Subscription = z.object({
  planName: z.string().nullish(),
  chargedThroughDate: z.string().nullish(),
});
export async function readSubscription(subscriptionId: string): Promise<z.infer<typeof Subscription>> {
  return Subscription.parse(await (await sendOk(`/subscriptions/${subscriptionId}`)).json());
}

export async function changePlanAtTermEnd(subscriptionId: string, cadence: Cadence): Promise<void> {
  await sendOk(`/subscriptions/${subscriptionId}?billingPolicy=END_OF_TERM`, {
    method: "PUT",
    body: JSON.stringify({ planName: PLAN_OF[cadence] }),
  });
}

export async function cancelAtTermEnd(subscriptionId: string): Promise<void> {
  await sendOk(`/subscriptions/${subscriptionId}?billingPolicy=END_OF_TERM&entitlementPolicy=END_OF_TERM`, { method: "DELETE" });
}

export async function cancelAtOnce(subscriptionId: string): Promise<void> {
  await send(`/subscriptions/${subscriptionId}?billingPolicy=IMMEDIATE&entitlementPolicy=IMMEDIATE`, { method: "DELETE" });
}

export async function undoCancel(subscriptionId: string): Promise<void> {
  await sendOk(`/subscriptions/${subscriptionId}/uncancel`, { method: "PUT" });
}

// JSON.parse hands a reviver the source text of each value, which the standard library's types leave out.
declare global {
  interface JSON {
    parse(text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown): unknown;
  }
}

// Kill Bill's JSON writes money as bare numbers. It is read as that decimal text and becomes integer cents at the door.
const MONEY_KEYS = new Set(["amount", "balance"]);

function withMoneyAsText(text: string): unknown {
  return JSON.parse(text, (key, value, { source }) => (MONEY_KEYS.has(key) && source !== undefined ? source : value));
}

const Cents = z.string().transform(centsFromAmount);

const Invoice = z.object({
  invoiceId: z.string(),
  amount: Cents,
  balance: Cents,
  currency: z.string(),
  items: z.array(z.object({
    description: z.string().nullish(),
    planName: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    amount: Cents,
  })),
});
type Invoice = z.infer<typeof Invoice>;

export function isPaid(invoice: Invoice): boolean {
  return invoice.amount > 0 && invoice.balance === 0;
}

export async function readInvoices(accountId: string): Promise<Invoice[]> {
  return z.array(Invoice).parse(withMoneyAsText(await (await sendOk(`/accounts/${accountId}/invoices?includeInvoiceComponents=true`)).text()));
}

const InvoicePayment = z.object({
  transactions: z.array(z.object({
    transactionType: z.string(),
    status: z.string(),
    effectiveDate: z.string(),
  })),
});

// The instant of the invoice's successful payment, or null when no payment succeeded yet.
export async function readPaidAt(invoiceId: string): Promise<Date | null> {
  const payments = z.array(InvoicePayment).parse(await (await sendOk(`/invoices/${invoiceId}/payments`)).json());
  const paid = payments
    .flatMap((payment) => payment.transactions)
    .find((transaction) => transaction.transactionType === "PURCHASE" && transaction.status === "SUCCESS");
  return paid ? new Date(paid.effectiveDate) : null;
}

export async function scrubAccount(accountId: string): Promise<void> {
  await sendOk(`/accounts/${accountId}`, {
    method: "PUT",
    body: JSON.stringify({ name: "Erased member", email: "", phone: "" }),
  });
}

export async function checkAccountReachable(memberId: string): Promise<void> {
  await send(`/accounts?externalKey=${encodeURIComponent(memberId)}`);
}
