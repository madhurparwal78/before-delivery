// Kill Bill: catalog, accounts and subscriptions for the Sync and Publish add-ons.
import { config } from "./config.ts";
import type { AddonName } from "../shared/types.ts";

export class BillingUnavailable extends Error {}

const { url, username, password, apiKey, apiSecret } = config.killbill;
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const PLANS: Record<AddonName, string> = { sync: "cairn-sync-monthly", publish: "cairn-publish-monthly" };

async function kb(method: string, path: string, options: { query?: Record<string, string>; body?: string; contentType?: string } = {}): Promise<{ status: number; data: unknown }> {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}${query}`, {
      method,
      headers: {
        Authorization: auth, "X-Killbill-ApiKey": apiKey, "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "cairn", Accept: "application/json",
        ...(options.contentType ? { "Content-Type": options.contentType } : {}),
      },
      body: options.body,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BillingUnavailable("Kill Bill unreachable");
  }
  if (response.status >= 500) throw new BillingUnavailable(`Kill Bill answered ${response.status}`);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

function expect(result: { status: number; data: unknown }, ok: number[], action: string): void {
  if (!ok.includes(result.status)) throw new BillingUnavailable(`${action}: Kill Bill answered ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
}

const CATALOG = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Cairn</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="CairnSync"><category>BASE</category></product>
    <product name="CairnPublish"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>
    <plan name="cairn-sync-monthly">
      <product>CairnSync</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>6.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="cairn-publish-monthly">
      <product>CairnPublish</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>9.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>cairn-sync-monthly</plan><plan>cairn-publish-monthly</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;

/** Uploads the catalog when the tenant has none. */
export async function ensureCatalog(): Promise<void> {
  const current = await kb("GET", "/catalog");
  expect(current, [200], "read catalog");
  if (Array.isArray(current.data) && current.data.length > 0) return;
  expect(await kb("POST", "/catalog/xml", { body: CATALOG, contentType: "text/xml" }), [201], "upload catalog");
}

export interface CairnAccountRef {
  id: string;
  email: string;
  display_name: string;
  time_zone: string;
}

/** The Kill Bill account id for a Cairn account (external key = Cairn id), or null. */
export async function findAccount(cairnId: string): Promise<string | null> {
  const result = await kb("GET", "/accounts", { query: { externalKey: cairnId } });
  if (result.status === 404) return null;
  expect(result, [200], "find account");
  return (result.data as { accountId: string }).accountId;
}

export async function createAccount(account: CairnAccountRef): Promise<string> {
  const created = await kb("POST", "/accounts", {
    body: JSON.stringify({ name: account.display_name, email: account.email, currency: "USD", timeZone: account.time_zone, externalKey: account.id }),
    contentType: "application/json",
  });
  if (created.status === 409) return (await findAccount(account.id)) as string;
  expect(created, [201], "create account");
  return (await findAccount(account.id)) as string;
}

interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  startDate: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  cancelledDate: string | null;
}

export async function subscriptions(kbAccountId: string): Promise<KbSubscription[]> {
  const result = await kb("GET", `/accounts/${kbAccountId}/bundles`);
  expect(result, [200], "read bundles");
  return (result.data as { subscriptions: KbSubscription[] }[]).flatMap((b) => b.subscriptions);
}

/** The subscription that decides an add-on: an uncancelled one, else the most recent. */
export function current(subs: KbSubscription[], addon: AddonName): KbSubscription | null {
  const mine = subs.filter((s) => s.planName === PLANS[addon]).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return mine.find((s) => s.state !== "CANCELLED") ?? mine[0] ?? null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One subscription in its own bundle; returns once Kill Bill has invoiced the first term. */
export async function createSubscription(kbAccountId: string, cairnId: string, addon: AddonName): Promise<void> {
  const key = `${cairnId}-${addon}`;
  const result = await kb("POST", "/subscriptions", {
    body: JSON.stringify({ accountId: kbAccountId, bundleExternalKey: key, externalKey: key, planName: PLANS[addon] }),
    contentType: "application/json",
  });
  expect(result, [201], "create subscription");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const sub = current(await subscriptions(kbAccountId), addon);
    if (sub?.chargedThroughDate) return;
    await wait(200);
  }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const result = await kb("DELETE", `/subscriptions/${subscriptionId}`, {
    query: { entitlementPolicy: "END_OF_TERM", billingPolicy: "END_OF_TERM" },
  });
  expect(result, [204], "cancel subscription");
}
