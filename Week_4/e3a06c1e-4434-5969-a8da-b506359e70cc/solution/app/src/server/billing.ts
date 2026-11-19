// Kill Bill: the catalog, one account and subscription per organisation, usage records for closed
// sessions and plan changes. Every call opens a fresh request to the configured address.
import { config } from "./config";
import { send, type OutboundResponse } from "./outbound";
import { describe } from "./http";
import { every } from "./schedule";
import { one, rows, pool } from "./db";
import { CENTS_PER_MINUTE, PLANS, type Plan } from "../shared/billing";
import { isRecord } from "../shared/guards";

class BillingUnavailable extends Error {
  constructor() {
    super("Billing is unreachable");
  }
}

const CATALOG_PLAN: Record<Plan, string> = { pilot: "lowfield-pilot", scale: "lowfield-scale" };
/** USD per billable second in the catalog, from the published cents per billable minute. */
const unitPrice = (plan: Plan) => String(CENTS_PER_MINUTE[plan] / 6000);
const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function kb(method: string, path: string, body?: string, contentType = "application/json"): Promise<OutboundResponse> {
  try {
    const response = await send(
      new URL(`${config.killbill.url}/1.0/kb${path}`),
      method,
      {
        authorization: AUTH,
        "x-killbill-apikey": config.killbill.apiKey,
        "x-killbill-apisecret": config.killbill.apiSecret,
        "x-killbill-createdby": "lowfield-console",
        accept: "application/json",
        ...(body !== undefined ? { "content-type": contentType } : {}),
      },
      body === undefined ? undefined : Buffer.from(body),
      8000,
    );
    if (response.status >= 500) throw new BillingUnavailable();
    return response;
  } catch (error) {
    if (error instanceof BillingUnavailable) throw error;
    throw new BillingUnavailable();
  }
}

/** A Kill Bill reply body; a body that is not JSON counts as billing being unavailable. */
function json(response: OutboundResponse): unknown {
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new BillingUnavailable();
  }
}

// ---- reachability probe ----
let reachable = false;
let probedAt = 0;

/** Any answer from the tenant API below 500 means Kill Bill is there; a refused or timed-out call means it isn't. */
async function probe(): Promise<void> {
  try {
    await kb("GET", "/catalog/versions");
    reachable = true;
  } catch {
    reachable = false;
  }
  probedAt = Date.now();
}

/** Billing reachability from a probe at most 5 seconds old. */
export function billingReachable(): boolean {
  return reachable && Date.now() - probedAt <= 5000;
}

// ---- catalog, accounts and subscriptions ----
function catalogXml(effectiveDate: string): string {
  const plan = (name: Plan) => `
    <plan name="${CATALOG_PLAN[name]}">
      <product>lowfield-console</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <usages>
          <usage name="${CATALOG_PLAN[name]}-billable-seconds" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers><tier><blocks><tieredBlock>
              <unit>billable-second</unit><size>1</size>
              <prices><price><currency>USD</currency><value>${unitPrice(name)}</value></price></prices>
              <max>-1</max>
            </tieredBlock></blocks></tier></tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effectiveDate}</effectiveDate>
  <catalogName>lowfield</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <units><unit name="billable-second"/></units>
  <products><product name="lowfield-console"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${PLANS.map(plan).join("")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans>${PLANS.map((p) => `<plan>${CATALOG_PLAN[p]}</plan>`).join("")}</plans></defaultPriceList>
  </priceLists>
</catalog>`;
}

async function catalogHasPlans(): Promise<boolean> {
  const response = await kb("GET", "/catalog");
  if (!response.ok) {
    return false;
  }
  const text = response.body.toString("utf8");
  return PLANS.every((p) => text.includes(`"${CATALOG_PLAN[p]}"`));
}

/**
 * Instances starting together on one tenant must not upload versions with one effective date: Kill Bill
 * then can't load the tenant's catalog at all. A random pause lets the first upload land before the rest
 * look again, and each upload takes a random whole second in the past hour, later than the empty default
 * version Kill Bill gives a new tenant.
 */
async function ensureCatalog(): Promise<void> {
  if (await catalogHasPlans()) return;
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 5000));
  if (await catalogHasPlans()) return;
  const effective = new Date((Math.floor(Date.now() / 1000) - 60 - Math.floor(Math.random() * 3600)) * 1000);
  await kb("POST", "/catalog/xml", catalogXml(effective.toISOString()), "text/xml");
  // Another instance may have uploaded the same catalog first; either way it must now be there.
  if (!(await catalogHasPlans())) throw new BillingUnavailable();
}

interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
}

function subscriptionOf(value: unknown): KbSubscription | null {
  if (!isRecord(value)) return null;
  const { subscriptionId, planName, state } = value;
  return typeof subscriptionId === "string" && typeof planName === "string" && typeof state === "string" ? { subscriptionId, planName, state } : null;
}

/** The catalog plan of a subscription read back from Kill Bill. */
function planNameOf(response: OutboundResponse): string {
  const subscription = subscriptionOf(json(response));
  if (!subscription) throw new BillingUnavailable();
  return subscription.planName;
}

async function accountId(externalKey: string, name: string): Promise<string> {
  const lookup = () => kb("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  let response = await lookup();
  if (response.status === 404) {
    await kb("POST", "/accounts", JSON.stringify({ name, externalKey, currency: "USD" }));
    response = await lookup();
  }
  if (!response.ok) throw new BillingUnavailable();
  const account = json(response);
  if (!isRecord(account) || typeof account.accountId !== "string") throw new BillingUnavailable();
  return account.accountId;
}

async function activeSubscription(account: string): Promise<KbSubscription | undefined> {
  const response = await kb("GET", `/accounts/${account}/bundles`);
  if (!response.ok) throw new BillingUnavailable();
  const bundles = json(response);
  if (!Array.isArray(bundles)) throw new BillingUnavailable();
  const plans = Object.values(CATALOG_PLAN);
  return bundles
    .flatMap((bundle) => (isRecord(bundle) && Array.isArray(bundle.subscriptions) ? bundle.subscriptions : []))
    .map(subscriptionOf)
    .find((s): s is KbSubscription => s !== null && s.state !== "CANCELLED" && plans.includes(s.planName));
}

async function ensureOrganisation(org: { id: string; name: string; slug: string; plan: Plan }): Promise<void> {
  const externalKey = `${config.billingPrefix}-${org.slug}`;
  const account = await accountId(externalKey, org.name);
  let subscription = await activeSubscription(account);
  if (!subscription) {
    await kb("POST", "/subscriptions", JSON.stringify({ accountId: account, planName: CATALOG_PLAN[org.plan], bundleExternalKey: externalKey }));
    subscription = await activeSubscription(account);
  }
  if (!subscription) throw new BillingUnavailable();
  await pool.query("UPDATE orgs SET kb_account_id = $2, kb_subscription_id = $3 WHERE id = $1", [org.id, account, subscription.subscriptionId]);
}

/** Catalog, accounts and subscriptions for every organisation still missing one, retried until Kill Bill answers. */
async function bootstrap(): Promise<void> {
  const missing = await rows<{ id: string; name: string; slug: string; plan: Plan }>("SELECT id, name, slug, plan FROM orgs WHERE kb_subscription_id IS NULL");
  if (missing.length === 0) return;
  await ensureCatalog();
  for (const org of missing) await ensureOrganisation(org);
}

let bootstrapNoted = "";
async function bootstrapLogged(): Promise<void> {
  try {
    await bootstrap();
    bootstrapNoted = "";
  } catch (error) {
    const message = error instanceof BillingUnavailable ? error.message : describe(error);
    if (message !== bootstrapNoted) console.error(`billing setup pending: ${message}`);
    bootstrapNoted = message;
  }
}

// ---- usage records ----
/** Records one session's usage. A claim on the row keeps two instances (or two loops) from sending it at once. */
async function recordUsage(session: { id: string; billable_seconds: number; ended_at: Date; kb_subscription_id: string }): Promise<void> {
  const claimed = await one(
    `UPDATE sessions SET billing_claimed_at = now()
      WHERE id = $1 AND billing_state = 'pending' AND (billing_claimed_at IS NULL OR billing_claimed_at < now() - interval '30 seconds')
      RETURNING id`,
    [session.id],
  );
  if (!claimed) return;
  try {
    await sendUsage(session);
  } finally {
    await pool.query("UPDATE sessions SET billing_claimed_at = NULL WHERE id = $1", [session.id]);
  }
}

async function sendUsage(session: { id: string; billable_seconds: number; ended_at: Date; kb_subscription_id: string }): Promise<void> {
  const response = await kb(
    "POST",
    "/usages",
    JSON.stringify({
      subscriptionId: session.kb_subscription_id,
      trackingId: session.id,
      unitUsageRecords: [{ unitType: "billable-second", usageRecords: [{ recordDate: session.ended_at.toISOString(), amount: session.billable_seconds }] }],
    }),
  );
  const text = response.body.toString("utf8");
  // Kill Bill reporting that the tracking id already exists means this record was accepted before.
  const accepted = response.ok || (response.status === 400 && /tracking id .* already exists/i.test(text));
  if (accepted) await pool.query("UPDATE sessions SET billing_state = 'confirmed' WHERE id = $1 AND billing_state = 'pending'", [session.id]);
}

/** Sends every pending usage record; called at close and by the 5-second retry loop. */
export async function flushUsage(sessionId?: string): Promise<void> {
  const pending = await rows<{ id: string; billable_seconds: number; ended_at: Date; kb_subscription_id: string }>(
    `SELECT s.id, s.billable_seconds, s.ended_at, o.kb_subscription_id
       FROM sessions s JOIN projects p ON p.id = s.project_id JOIN orgs o ON o.id = p.org_id
      WHERE s.billing_state = 'pending' AND o.kb_subscription_id IS NOT NULL ${sessionId ? "AND s.id = $1" : ""}
      ORDER BY s.ended_at LIMIT 200`,
    sessionId ? [sessionId] : [],
  );
  for (const session of pending) await recordUsage(session);
}

// ---- plan changes ----
/** Moves a requested change to confirmed (read back from Kill Bill with the target plan) or failed (Kill Bill refused). */
export async function resolvePlanChange(changeId: string): Promise<void> {
  const change = await one<{ id: string; org_id: string; target: Plan; kb_subscription_id: string | null }>(
    "SELECT c.id, c.org_id, c.target, o.kb_subscription_id FROM plan_changes c JOIN orgs o ON o.id = c.org_id WHERE c.id = $1 AND c.state = 'requested'",
    [changeId],
  );
  if (!change?.kb_subscription_id) return;
  const path = `/subscriptions/${change.kb_subscription_id}`;
  const before = await kb("GET", path);
  if (!before.ok) throw new BillingUnavailable();
  if (planNameOf(before) !== CATALOG_PLAN[change.target]) {
    const changed = await kb("PUT", `${path}?billingPolicy=IMMEDIATE`, JSON.stringify({ planName: CATALOG_PLAN[change.target] }));
    if (changed.status >= 400) {
      await pool.query("UPDATE plan_changes SET state = 'failed', decided_at = now() WHERE id = $1 AND state = 'requested'", [change.id]);
      return;
    }
  }
  const after = await kb("GET", path);
  if (!after.ok) throw new BillingUnavailable();
  if (planNameOf(after) !== CATALOG_PLAN[change.target]) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query("UPDATE plan_changes SET state = 'confirmed', decided_at = now() WHERE id = $1 AND state = 'requested'", [change.id]);
    if (updated.rowCount) await client.query("UPDATE orgs SET plan = $2 WHERE id = $1", [change.org_id, change.target]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function resolveOpenChanges(): Promise<void> {
  for (const change of await rows<{ id: string }>("SELECT id FROM plan_changes WHERE state = 'requested'")) await resolvePlanChange(change.id);
}

export function startBilling(): void {
  every(2000, probe);
  every(3000, bootstrapLogged);
  every(5000, () => flushUsage());
  every(2000, resolveOpenChanges);
}
