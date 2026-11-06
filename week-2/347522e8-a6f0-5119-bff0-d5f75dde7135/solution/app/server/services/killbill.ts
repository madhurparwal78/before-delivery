// Kill Bill over HTTP. Every call is made fresh (no keep-alive, no cached failure or availability)
// and bounded by its own timeout of at most five seconds, so billing that returns is used at once.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { config } from "../config.js";

export const KILLBILL_TIMEOUT_MS = 5000;
export const KILLBILL_READ_TIMEOUT_MS = 2000;
export const SHELF_PLAN = "walk-in-shelf-monthly";

/** Kill Bill could not be reached (or failed) before the deadline. */
export class BillingUnavailable extends Error {}
/** Kill Bill answered and declined the payment. */
export class PaymentDeclined extends Error {}

/** The timeout each Kill Bill call of one operation gets on its own, in milliseconds. */
export type Deadline = number;

export function deadlineIn(ms: number): Deadline {
  return ms;
}

interface KbResponse {
  status: number;
  location: string | null;
  text: string;
}

function call(method: string, path: string, deadline: Deadline, body?: string, contentType = "application/json"): Promise<KbResponse> {
  const remaining = deadline;
  const url = new URL(`${config.killbill.url}${path}`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "railside",
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = contentType;
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  const answer = new Promise<KbResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      outgoing.destroy(new BillingUnavailable("timed out"));
    }, remaining);
    const outgoing = send(url, { method, headers, agent: false }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        clearTimeout(timer);
        const response = {
          status: incoming.statusCode ?? 0,
          location: incoming.headers.location ?? null,
          text: Buffer.concat(chunks).toString("utf8"),
        };
        if (response.status >= 500) reject(new BillingUnavailable(`Kill Bill answered ${response.status}`));
        else resolve(response);
      });
      incoming.on("error", (error) => {
        clearTimeout(timer);
        reject(new BillingUnavailable(error.message));
      });
    });
    outgoing.on("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof BillingUnavailable ? error : new BillingUnavailable(error.message));
    });
    outgoing.end(body);
  });
  // The reason never reaches the caller (it sees billing_unavailable), so the operator reads it here.
  answer.catch((error: unknown) => console.warn(`Kill Bill ${method} ${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`));
  return answer;
}

/** A field of a parsed Kill Bill JSON object, unchecked until the caller narrows it. */
function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function stringField(value: unknown, name: string): string | null {
  const field = fieldOf(value, name);
  return typeof field === "string" ? field : null;
}

function bodyOf(response: KbResponse): unknown {
  return JSON.parse(response.text);
}

function unexpected(response: KbResponse, what: string): Error {
  return new Error(`Kill Bill ${what} answered ${response.status}: ${response.text.slice(0, 300)}`);
}

function idFromLocation(response: KbResponse, what: string): string {
  const id = response.location?.split("?")[0]?.replace(/\/+$/, "").split("/").pop();
  if (response.status !== 201 || !id) throw unexpected(response, what);
  return id;
}

/** The live purchases-available check: Kill Bill answers its healthcheck within two seconds. */
export async function billingReachable(): Promise<boolean> {
  try {
    return (await call("GET", "/1.0/healthcheck", deadlineIn(KILLBILL_READ_TIMEOUT_MS))).status === 200;
  } catch {
    return false;
  }
}

export interface BillingRenter {
  id: string;
  business_name: string;
  email: string;
}

/** The renter's account (external key `renter-<id>`), created with a default external payment method the first time. */
export async function ensureAccount(renter: BillingRenter, deadline: Deadline): Promise<string> {
  const externalKey = `renter-${renter.id}`;
  let found = await call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, deadline);
  if (found.status === 404) {
    const created = await call(
      "POST",
      "/1.0/kb/accounts",
      deadline,
      JSON.stringify({ externalKey, name: renter.business_name, email: renter.email, currency: "USD" }),
    );
    if (created.status !== 201 && created.status !== 409) throw unexpected(created, "account creation");
    found = await call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, deadline);
  }
  if (found.status !== 200) throw unexpected(found, "account lookup");
  const body = bodyOf(found);
  const account = { accountId: stringField(body, "accountId"), paymentMethodId: stringField(body, "paymentMethodId") };
  if (account.accountId === null) throw unexpected(found, "account read");
  if (!account.paymentMethodId) {
    const method = await call(
      "POST",
      `/1.0/kb/accounts/${account.accountId}/paymentMethods?isDefault=true`,
      deadline,
      JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: { properties: [] } }),
    );
    // 7023: a concurrent request for the same renter added the default method first.
    if (method.status !== 201 && !(method.status === 400 && method.text.includes('"code":7023'))) {
      throw unexpected(method, "payment method");
    }
  }
  return account.accountId;
}


/** A PURCHASE payment under `externalKey`; a retry finds the existing payment instead of charging again. */
export async function purchasePayment(accountId: string, amountUsd: string, externalKey: string, deadline: Deadline): Promise<string> {
  const existing = await call("GET", `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`, deadline);
  if (existing.status === 200) {
    const payment = bodyOf(existing);
    const paymentId = stringField(payment, "paymentId");
    const transactions = fieldOf(payment, "transactions");
    const purchased = Array.isArray(transactions) && transactions.some((t) => stringField(t, "transactionType") === "PURCHASE" && stringField(t, "status") === "SUCCESS");
    if (paymentId !== null && purchased) return paymentId;
  }
  const created = await call(
    "POST",
    `/1.0/kb/accounts/${accountId}/payments`,
    deadline,
    JSON.stringify({
      transactionType: "PURCHASE",
      amount: amountUsd,
      currency: "USD",
      paymentExternalKey: externalKey,
      transactionExternalKey: externalKey,
    }),
  );
  if (created.status === 402) throw new PaymentDeclined(created.text);
  return idFromLocation(created, "payment");
}

export async function refundPayment(paymentId: string, amountUsd: string, deadline: Deadline): Promise<void> {
  const refund = await call("POST", `/1.0/kb/payments/${paymentId}/refunds`, deadline, JSON.stringify({ amount: amountUsd, currency: "USD" }));
  if (refund.status !== 201) throw unexpected(refund, "refund");
}

/** An external charge on the renter's account, committed at once. */
export async function externalCharge(accountId: string, amountUsd: string, description: string, deadline: Deadline): Promise<void> {
  const charge = await call(
    "POST",
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    deadline,
    JSON.stringify([{ accountId, amount: amountUsd, currency: "USD", description }]),
  );
  if (charge.status !== 201 && charge.status !== 200) throw unexpected(charge, "external charge");
}

const SHELF_CATALOG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2026-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>RailsideShelves</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <units/>
  <products>
    <product name="WalkInShelf"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    <plan name="${SHELF_PLAN}">
      <product>WalkInShelf</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>45.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>${SHELF_PLAN}</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;

/** Uploads the walk-in shelf catalog when the tenant has no catalog with that plan. */
async function ensureShelfCatalog(deadline: Deadline): Promise<void> {
  const catalog = await call("GET", "/1.0/kb/catalog", deadline);
  if (catalog.status === 200 && catalog.text.includes(`"${SHELF_PLAN}"`)) return;
  const upload = await call("POST", "/1.0/kb/catalog/xml", deadline, SHELF_CATALOG, "text/xml");
  if (upload.status !== 201) throw unexpected(upload, "catalog upload");
}

type KbSubscriptionState = "ACTIVE" | "CANCELLED" | "PENDING" | "BLOCKED" | "EXPIRED";

const KB_SUBSCRIPTION_STATES: readonly KbSubscriptionState[] = ["ACTIVE", "CANCELLED", "PENDING", "BLOCKED", "EXPIRED"];

export async function subscriptionState(subscriptionId: string, deadline: Deadline): Promise<KbSubscriptionState> {
  const found = await call("GET", `/1.0/kb/subscriptions/${subscriptionId}`, deadline);
  if (found.status !== 200) throw unexpected(found, "subscription lookup");
  const state = KB_SUBSCRIPTION_STATES.find((known) => known === stringField(bodyOf(found), "state"));
  if (!state) throw unexpected(found, "subscription read");
  return state;
}

export async function createShelfSubscription(accountId: string, externalKey: string, deadline: Deadline): Promise<string> {
  await ensureShelfCatalog(deadline);
  const created = await call(
    "POST",
    "/1.0/kb/subscriptions",
    deadline,
    JSON.stringify({ accountId, externalKey, bundleExternalKey: externalKey, planName: SHELF_PLAN }),
  );
  return idFromLocation(created, "subscription");
}

export async function cancelSubscription(subscriptionId: string, deadline: Deadline): Promise<void> {
  const cancelled = await call(
    "DELETE",
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`,
    deadline,
  );
  if (cancelled.status !== 204 && cancelled.status !== 200) throw unexpected(cancelled, "subscription cancel");
}
