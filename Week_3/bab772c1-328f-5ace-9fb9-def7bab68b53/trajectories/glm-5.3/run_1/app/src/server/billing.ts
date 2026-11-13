// Kill Bill: the Archive plan catalogue, the author's billing account and its
// subscription. Amounts are decimal major units in the transport and integer
// cents in the app.

import { DependencyError, fetchWithTimeout, requireEnv } from "./deps.js";
import type { PlanId } from "../shared/format.js";

const KB_TIMEOUT_MS = 10000;

function base(): string {
  return requireEnv("KILLBILL_URL").replace(/\/$/, "");
}

function auth(): string {
  const username = requireEnv("KILLBILL_USERNAME");
  const password = requireEnv("KILLBILL_PASSWORD");
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function tenantHeaders(): Record<string, string> {
  return {
    "X-Killbill-ApiKey": requireEnv("KILLBILL_API_KEY"),
    "X-Killbill-ApiSecret": requireEnv("KILLBILL_API_SECRET"),
  };
}

async function kb<T>(
  path: string,
  init: RequestInit,
  timeoutMs = KB_TIMEOUT_MS,
): Promise<{ status: number; body: T | null }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", auth());
  for (const [k, v] of Object.entries(tenantHeaders())) headers.set(k, v);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(`${base()}${path}`, { ...init, headers }, timeoutMs);
  } catch {
    throw new DependencyError("billing");
  }
  const text = await response.text().catch(() => "");
  let body: T | null = null;
  if (text !== "") {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

export const CATALOGUE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="CatalogSchema.xsd ">
  <effectiveDate>2026-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>perilune-archive</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="archive">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_SUBSCRIPTION</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
      </cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>SUBSCRIPTION</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="archive-free">
      <product>archive</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>0.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="archive-1">
      <product>archive</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>4.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="archive-10-annual">
      <product>archive</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>ANNUAL</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>288.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>archive-free</plan>
        <plan>archive-1</plan>
        <plan>archive-10-annual</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

export async function ensureCatalogue(): Promise<void> {
  let haveCatalogue = false;
  try {
    const response = await fetchWithTimeout(
      `${base()}/1.0/kb/catalog/xml`,
      { method: "GET", headers: { Authorization: auth(), ...tenantHeaders() } },
      5000,
    );
    if (response.ok) {
      const xml = await response.text();
      haveCatalogue = xml.includes("perilune-archive") && xml.includes("2026-01-01");
    }
  } catch {
    throw new DependencyError("billing");
  }
  if (haveCatalogue) return;
  const upload = await fetchWithTimeout(
    `${base()}/1.0/kb/catalog`,
    {
      method: "POST",
      headers: {
        Authorization: auth(),
        ...tenantHeaders(),
        "Content-Type": "text/xml",
        "X-Killbill-CreatedBy": "perilune-ledger",
      },
      body: CATALOGUE_XML,
    },
    KB_TIMEOUT_MS,
  ).catch(() => null);
  if (!upload) throw new DependencyError("billing");
  // A 400 means the tenant already holds this catalogue version.
  if (!upload.ok && upload.status !== 400) {
    throw new DependencyError("billing");
  }
}

interface AccountResponse {
  accountId: string;
}

export async function ensureAccount(): Promise<string> {
  const found = await kb<AccountResponse | AccountResponse[]>(
    "/1.0/kb/accounts?externalKey=perilune-author",
    { method: "GET" },
    5000,
  );
  const body = found.body;
  if (found.status === 200 && body) {
    const account = Array.isArray(body) ? body[0] : body;
    if (account?.accountId) return account.accountId;
  }
  const created = await kb<null>("/1.0/kb/accounts", {
    method: "POST",
    headers: { "X-Killbill-CreatedBy": "perilune-ledger" },
    body: JSON.stringify({
      name: "Perilune Ledger author",
      externalKey: "perilune-author",
      currency: "USD",
    }),
  });
  if (created.status !== 201) {
    throw new DependencyError("billing");
  }
  const again = await kb<AccountResponse | AccountResponse[]>(
    "/1.0/kb/accounts?externalKey=perilune-author",
    { method: "GET" },
    5000,
  );
  const account = Array.isArray(again.body) ? again.body[0] : again.body;
  if (again.status !== 200 || !account?.accountId) {
    throw new DependencyError("billing");
  }
  return account.accountId;
}

interface SubscriptionResponse {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  bundleId: string;
}

export async function listSubscriptions(accountId: string): Promise<SubscriptionResponse[]> {
  const result = await kb<Array<{ subscriptions: SubscriptionResponse[] }>>(
    `/1.0/kb/accounts/${accountId}/bundles?limit=100`,
    { method: "GET" },
    5000,
  );
  if (result.status !== 200 || !result.body) {
    throw new DependencyError("billing");
  }
  const subs: SubscriptionResponse[] = [];
  for (const bundle of result.body) {
    for (const sub of bundle.subscriptions ?? []) {
      if (sub.state === "ACTIVE") subs.push(sub);
    }
  }
  return subs;
}

export async function createSubscription(
  accountId: string,
  plan: PlanId,
): Promise<void> {
  const result = await kb<null>(
    `/1.0/kb/subscriptions?externalKey=perilune-archive&accountId=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { "X-Killbill-CreatedBy": "perilune-ledger" },
      body: JSON.stringify({ planName: plan, phaseType: "EVERGREEN", accountId }),
    },
  );
  if (result.status !== 201) {
    throw new DependencyError("billing");
  }
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  plan: PlanId,
): Promise<void> {
  const result = await kb<null>(`/1.0/kb/subscriptions/${subscriptionId}`, {
    method: "PUT",
    headers: { "X-Killbill-CreatedBy": "perilune-ledger" },
    body: JSON.stringify({ planName: plan, phaseType: "EVERGREEN" }),
  });
  if (result.status !== 204) {
    throw new DependencyError("billing");
  }
}

export interface BillingState {
  subscription: SubscriptionResponse | null;
  balanceCents: number;
}

interface InvoiceResponse {
  amount: number;
  balance: number;
  creditAdj: number;
  refundAdj: number;
}

function decimalToCents(value: number): number {
  const rounded = Math.round(value * 100);
  return Number.isFinite(rounded) ? rounded : 0;
}

export async function readBillingState(accountId: string): Promise<BillingState> {
  const subs = await listSubscriptions(accountId);
  const subscription = subs.length > 0 ? subs[0] : null;
  const invoices = await kb<InvoiceResponse[]>(
    `/1.0/kb/accounts/${accountId}/invoices?limit=100&withItems=false`,
    { method: "GET" },
    5000,
  );
  let balanceCents = 0;
  if (invoices.status === 200 && Array.isArray(invoices.body)) {
    let sum = 0;
    for (const invoice of invoices.body) {
      const amount = Number(invoice.amount);
      const balance = Number(invoice.balance);
      if (!Number.isFinite(balance)) continue;
      if (balance > 0) {
        sum += amount;
      }
      sum += balance > 0 ? balance - amount : 0;
      if (balance < 0) sum += balance;
    }
    balanceCents = decimalToCents(sum);
  }
  return { subscription, balanceCents };
}

export async function probeBilling(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${base()}/1.0/kb/catalog`,
      { method: "GET", headers: { Authorization: auth(), ...tenantHeaders() } },
      1000,
    );
    return response.status !== 404 && response.status !== 401;
  } catch {
    return false;
  }
}
