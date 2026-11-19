// Kill Bill, the source of truth for each workspace's plan (brief: Services > Kill Bill, Business rules >
// Plans, Plan source of truth). Money stays in integer cents; Kill Bill's catalog gets decimal strings.
import { config } from "./config.js";
import { many, pool, returning, type Db } from "./db.js";
import { Unavailable } from "./errors.js";

export const PLANS = {
  "rushes-pro-5": { planName: "Pro 5 seats", seatCap: 5, monthlyCents: 15000 },
  "rushes-pro-10": { planName: "Pro 10 seats", seatCap: 10, monthlyCents: 28000 },
  "rushes-pro-25": { planName: "Pro 25 seats", seatCap: 25, monthlyCents: 65000 },
} as const;
export type PlanId = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const isPlanId = (value: string): value is PlanId => value in PLANS;
export const dollars = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const PRODUCT = "RushesPro";
const TIMEOUT_MS = 10_000;

interface BillingWorkspace {
  id: string;
  slug: string;
  name: string;
  seeded_plan: PlanId;
  plan: PlanId;
  billing_account_id: string | null;
  billing_subscription_id: string | null;
  billing_synced: boolean;
}

interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Kill Bill's answers are checked field by field before the plan is believed. */
function subscriptionsIn(bundles: unknown): KbSubscription[] {
  return list(bundles)
    .flatMap((bundle) => (isRecord(bundle) ? list(bundle.subscriptions) : []))
    .flatMap((s) =>
      isRecord(s) && typeof s.subscriptionId === "string" && typeof s.planName === "string" && typeof s.state === "string"
        ? [{ subscriptionId: s.subscriptionId, planName: s.planName, state: s.state }]
        : [],
    );
}

const accountIdIn = (account: unknown): string | null => (isRecord(account) && typeof account.accountId === "string" ? account.accountId : null);

const planNamesIn = (catalogs: unknown): string[] =>
  list(catalogs)
    .flatMap((c) => (isRecord(c) ? list(c.products) : []))
    .flatMap((p) => (isRecord(p) ? list(p.plans) : []))
    .flatMap((plan) => (isRecord(plan) && typeof plan.name === "string" ? [plan.name] : []));

async function kb(method: string, path: string, body?: { json: unknown } | { xml: string }): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "x-killbill-apikey": apiKey,
    "x-killbill-apisecret": apiSecret,
    "x-killbill-createdby": "rushes",
    accept: "application/json",
  };
  let payload: string | undefined;
  if (body && "json" in body) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body) {
    headers["content-type"] = "text/xml";
    payload = body.xml;
  }
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, { method, headers, ...(payload ? { body: payload } : {}), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Unavailable("billing_unavailable", error);
  }
  if (response.status >= 500) throw new Unavailable("billing_unavailable", new Error(`${method} ${path}: ${response.status}`));
  return response;
}

async function kbJson(method: string, path: string, body?: { json: unknown }): Promise<unknown> {
  const response = await kb(method, path, body);
  if (response.status === 404) return null;
  if (!response.ok) throw new Unavailable("billing_unavailable", new Error(`${method} ${path}: ${response.status} ${await response.text()}`));
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

function catalogXml(): string {
  const plans = PLAN_IDS.map((id) => `
    <plan name="${id}">
      <product>${PRODUCT}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${dollars(PLANS[id].monthlyCents)}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>rushes</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products><product name="${PRODUCT}"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${plans}
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${PLAN_IDS.map((id) => `<plan>${id}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}

async function ensureCatalog(): Promise<void> {
  const known = new Set(planNamesIn(await kbJson("GET", "/catalog")));
  if (PLAN_IDS.every((id) => known.has(id))) return;
  const response = await kb("POST", "/catalog/xml", { xml: catalogXml() });
  if (!response.ok) throw new Unavailable("billing_unavailable", new Error(`catalog upload ${response.status} ${await response.text()}`));
}

async function activeSubscription(accountId: string, slug: string): Promise<KbSubscription | null> {
  const bundles = await kbJson("GET", `/accounts/${accountId}/bundles?externalKey=rushes-seats-${slug}`);
  return subscriptionsIn(bundles).find((s) => s.state === "ACTIVE") ?? null;
}

async function changeSubscription(subscriptionId: string, plan: PlanId): Promise<void> {
  const response = await kb("PUT", `/subscriptions/${subscriptionId}?billingPolicy=IMMEDIATE&callCompletion=true&callTimeoutSec=10`, { json: { planName: plan } });
  if (!response.ok) throw new Unavailable("billing_unavailable", new Error(`change plan ${response.status} ${await response.text()}`));
}

/** Creates the workspace's account and subscription when missing; on a fresh database puts it on its seeded plan. */
async function ensureWorkspace(ws: BillingWorkspace): Promise<void> {
  const externalKey = `rushes-ws-${ws.slug}`;
  let accountId = accountIdIn(await kbJson("GET", `/accounts?externalKey=${externalKey}`));
  if (!accountId) {
    const created = await kb("POST", "/accounts", { json: { name: ws.name, externalKey, currency: "USD" } });
    if (!created.ok && created.status !== 409) throw new Unavailable("billing_unavailable", new Error(`account ${created.status}`));
    accountId = accountIdIn(await kbJson("GET", `/accounts?externalKey=${externalKey}`));
    if (!accountId) throw new Unavailable("billing_unavailable", new Error("account missing after create"));
  }
  let subscription = await activeSubscription(accountId, ws.slug);
  if (!subscription) {
    const created = await kb("POST", "/subscriptions?callCompletion=true&callTimeoutSec=10", {
      json: { accountId: accountId, bundleExternalKey: `rushes-seats-${ws.slug}`, planName: ws.seeded_plan },
    });
    if (!created.ok) throw new Unavailable("billing_unavailable", new Error(`subscription ${created.status} ${await created.text()}`));
    subscription = await activeSubscription(accountId, ws.slug);
    if (!subscription) throw new Unavailable("billing_unavailable", new Error("subscription missing after create"));
  } else if (subscription.planName !== ws.seeded_plan) {
    await changeSubscription(subscription.subscriptionId, ws.seeded_plan);
  }
  await pool.query(
    "UPDATE workspaces SET billing_account_id = $2, billing_subscription_id = $3, billing_synced = true WHERE id = $1",
    [ws.id, accountId, subscription.subscriptionId],
  );
}

const BILLING_COLUMNS = "id, slug, name, seeded_plan, plan, billing_account_id, billing_subscription_id, billing_synced";

/** The start-up sync: catalog plus every workspace not yet synced. Serialised across instances. */
export async function syncBilling(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('rushes:billing-sync'))");
    const pending = await many<BillingWorkspace>(client, `SELECT ${BILLING_COLUMNS} FROM workspaces WHERE NOT billing_synced ORDER BY sort_order`);
    if (!pending.length) return;
    await ensureCatalog();
    for (const ws of pending) await ensureWorkspace(ws);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('rushes:billing-sync'))").catch(() => undefined);
    client.release();
  }
}

interface PlanRecord {
  plan: PlanId;
  seatCap: number;
}

const load = (db: Db, workspaceId: string): Promise<BillingWorkspace> =>
  returning<BillingWorkspace>(db, `SELECT ${BILLING_COLUMNS} FROM workspaces WHERE id = $1`, [workspaceId]);

async function subscriptionOf(workspaceId: string): Promise<{ subscriptionId: string; plan: PlanId }> {
  let ws = await load(pool, workspaceId);
  if (!ws.billing_synced) {
    await syncBilling();
    ws = await load(pool, workspaceId);
  }
  const subscription = ws.billing_account_id ? await activeSubscription(ws.billing_account_id, ws.slug) : null;
  const plan = subscription?.planName ?? "";
  if (!subscription || !isPlanId(plan)) throw new Unavailable("billing_unavailable", new Error("no active subscription"));
  return { subscriptionId: subscription.subscriptionId, plan };
}

/** Records the plan Kill Bill reported; the seat cap is always the plan's seat count. */
export async function recordPlan(workspaceId: string, plan: PlanId): Promise<PlanRecord> {
  await pool.query("UPDATE workspaces SET plan = $2 WHERE id = $1", [workspaceId, plan]);
  return { plan, seatCap: PLANS[plan].seatCap };
}

/** The plan read (brief: Plan source of truth): Kill Bill when reachable, else the last recorded plan. */
export async function readPlan(workspaceId: string): Promise<PlanRecord> {
  try {
    return await recordPlan(workspaceId, (await subscriptionOf(workspaceId)).plan);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    const { plan } = await load(pool, workspaceId);
    return { plan, seatCap: PLANS[plan].seatCap };
  }
}

/** Steps 1–2 of an upgrade: change the subscription now, then read it back. */
export async function changePlan(workspaceId: string, plan: PlanId): Promise<{ previous: PlanId; current: PlanId }> {
  const before = await subscriptionOf(workspaceId);
  await changeSubscription(before.subscriptionId, plan);
  return { previous: before.plan, current: (await subscriptionOf(workspaceId)).plan };
}

/** Undo of an upgrade whose receipt could not be sent. */
export async function restorePlan(workspaceId: string, plan: PlanId): Promise<void> {
  await changeSubscription((await subscriptionOf(workspaceId)).subscriptionId, plan);
}

