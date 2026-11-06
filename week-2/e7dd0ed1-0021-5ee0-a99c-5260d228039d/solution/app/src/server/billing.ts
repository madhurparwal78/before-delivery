// Kill Bill: one USD account and one subscription per workspace, and every sealed usage row posted
// once by its tracking ID (brief: Services, Kill Bill; Business rules, Billing sync).
import { authorize, membership } from "./access.js";
import { config } from "./config.js";
import { one, pool, query, row } from "./db.js";
import { invalid } from "./errors.js";
import { isoOrNull, isoSecond, send, sendJson, type Ctx } from "./http.js";
import { planOf, quotaBytes, workspaceTotals } from "./objects.js";
import { monthToDate, percentOf, periodOf, rowAmount, rowEnd, sealWindows, sumAmounts, usageRows, type UsageRow } from "./usage.js";
import { PLANS } from "../shared/plans.js";

class KillBillUnreachable extends Error {}

async function killbill(method: string, path: string, body?: string, contentType = "application/json"): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "farshore",
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": contentType } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new KillBillUnreachable(error instanceof Error ? error.message : "Kill Bill unreachable");
  }
}

async function expect(response: Response, what: string): Promise<string> {
  const text = await response.text();
  if (response.status >= 300) throw new KillBillUnreachable(`${what}: Kill Bill answered ${response.status} ${text.slice(0, 200)}`);
  return text;
}

const block = (unit: string, price: string): string =>
  `<tieredBlock><unit>${unit}</unit><size>1</size><prices><price><currency>USD</currency><value>${price}</value></price></prices><max>-1</max></tieredBlock>`;

const PRICES: Record<string, { monthly: string; storage: string; egress: string; requests: string }> = {
  sandbox: { monthly: "0.00", storage: "0", egress: "0", requests: "0" },
  indie: { monthly: "19.00", storage: "0.0000082", egress: "0.010", requests: "0.0000004" },
};

function catalogXml(): string {
  const plans = PLANS.map((plan) => {
    const price = PRICES[plan.id] ?? { monthly: "0.00", storage: "0", egress: "0", requests: "0" };
    return `<plan name="${plan.killbillPlan}"><product>${plan.name}</product><finalPhase type="EVERGREEN">` +
      `<duration><unit>UNLIMITED</unit></duration><recurring><billingPeriod>MONTHLY</billingPeriod><recurringPrice>` +
      `<price><currency>USD</currency><value>${price.monthly}</value></price></recurringPrice></recurring>` +
      `<usages><usage name="${plan.killbillPlan}-usage" billingMode="IN_ARREAR" usageType="CONSUMABLE"><billingPeriod>MONTHLY</billingPeriod>` +
      `<tiers><tier><blocks>${block("storage-gb-hours", price.storage)}${block("egress-gb", price.egress)}` +
      `${block("request-units", price.requests)}</blocks></tier></tiers></usage></usages></finalPhase></plan>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">` +
    `<effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate><catalogName>Farshore</catalogName>` +
    `<recurringBillingMode>IN_ADVANCE</recurringBillingMode><currencies><currency>USD</currency></currencies>` +
    `<units><unit name="storage-gb-hours"/><unit name="egress-gb"/><unit name="request-units"/></units>` +
    `<products>${PLANS.map((p) => `<product name="${p.name}"><category>BASE</category></product>`).join("")}</products>` +
    `<rules><changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>` +
    `<cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy></rules>` +
    `<plans>${plans}</plans><priceLists><defaultPriceList name="DEFAULT"><plans>` +
    `${PLANS.map((p) => `<plan>${p.killbillPlan}</plan>`).join("")}</plans></defaultPriceList></priceLists></catalog>`;
}

const UNREADABLE_CATALOG = /de-serialize catalog/i;

// Uploads the catalog when the tenant has none. Several Farshore processes may share one tenant and
// race to upload at start; a tenant left with catalog versions Kill Bill can no longer read is
// cleared and given the catalog once more.
async function ensureCatalog(): Promise<void> {
  const status = await one<{ catalog_uploaded: boolean }>(pool, "SELECT catalog_uploaded FROM billing_status WHERE id = 1");
  if (status?.catalog_uploaded) return;
  const read = async (): Promise<{ ok: boolean; unreadable: boolean }> => {
    const response = await killbill("GET", "/catalog");
    const text = await response.text();
    return { ok: response.status === 200 && text.includes("farshore-indie-monthly"), unreadable: response.status >= 500 && UNREADABLE_CATALOG.test(text) };
  };
  let existing = await read();
  if (existing.unreadable) {
    await expect(await killbill("DELETE", "/catalog"), "clear catalog");
    existing = await read();
  }
  if (!existing.ok) {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000));
    if (!(await read()).ok) await expect(await killbill("POST", "/catalog/xml", catalogXml(), "text/xml"), "upload catalog");
  }
  if (!(await read()).ok) throw new KillBillUnreachable("catalog: Kill Bill could not read the uploaded catalog");
  await pool.query("UPDATE billing_status SET catalog_uploaded = true WHERE id = 1");
}

interface BillingWorkspace {
  id: string;
  slug: string;
  name: string;
  plan_id: string;
  killbill_account_id: string | null;
  killbill_subscription_id: string | null;
}

// Creates the workspace's account (external key farshore-<slug>) and subscription (farshore-<slug>-plan).
async function ensureAccount(ws: BillingWorkspace): Promise<string> {
  if (ws.killbill_subscription_id) return ws.killbill_subscription_id;
  let accountId = ws.killbill_account_id;
  if (!accountId) {
    const externalKey = `farshore-${ws.slug}`;
    let found = await killbill("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (found.status === 404) {
      await found.text();
      await expect(await killbill("POST", "/accounts", JSON.stringify({ name: ws.name, externalKey, currency: "USD" })), "create account");
      found = await killbill("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    }
    accountId = (JSON.parse(await expect(found, "read account")) as { accountId: string }).accountId;
    await pool.query("UPDATE workspaces SET killbill_account_id = $2 WHERE id = $1", [ws.id, accountId]);
  }
  const bundleKey = `farshore-${ws.slug}-plan`;
  const bundles = JSON.parse(await expect(await killbill("GET", `/accounts/${accountId}/bundles`), "read bundles")) as
    Array<{ externalKey: string; subscriptions: Array<{ subscriptionId: string }> }>;
  let subscriptionId = bundles.find((b) => b.externalKey === bundleKey)?.subscriptions[0]?.subscriptionId;
  if (!subscriptionId) {
    await expect(await killbill("POST", "/subscriptions", JSON.stringify({
      accountId, externalKey: bundleKey, bundleExternalKey: bundleKey, planName: planOf(ws.plan_id).killbillPlan,
    })), "create subscription");
    const after = JSON.parse(await expect(await killbill("GET", `/accounts/${accountId}/bundles`), "read bundles")) as typeof bundles;
    subscriptionId = after.find((b) => b.externalKey === bundleKey)?.subscriptions[0]?.subscriptionId;
    if (!subscriptionId) throw new KillBillUnreachable("subscription not found after creation");
  }
  await pool.query("UPDATE workspaces SET killbill_subscription_id = $2 WHERE id = $1", [ws.id, subscriptionId]);
  return subscriptionId;
}

// Posts one sealed row. It counts as posted only when Kill Bill accepts it or already holds its tracking ID.
async function postRow(subscriptionId: string, row: { tracking_id: string; unit: string; window_start: Date; amount: string }): Promise<void> {
  const body = `{"subscriptionId":${JSON.stringify(subscriptionId)},"trackingId":${JSON.stringify(row.tracking_id)},` +
    `"unitUsageRecords":[{"unitType":${JSON.stringify(row.unit)},"usageRecords":[{"recordDate":"${row.window_start.toISOString().slice(0, 10)}",` +
    `"amount":${row.amount}}]}]}`;
  const response = await killbill("POST", "/usages", body);
  const text = await response.text();
  if (response.status < 300 || /tracking ID .* already exists/i.test(text)) return;
  throw new KillBillUnreachable(`post usage: Kill Bill answered ${response.status} ${text.slice(0, 200)}`);
}

async function recordAttempt(ok: boolean, error: string | null): Promise<void> {
  await pool.query("UPDATE billing_status SET last_attempt_at = now(), last_attempt_ok = $1, last_error = $2 WHERE id = 1", [ok, error]);
}

interface SyncResult {
  sealed: number;
  posted: number;
  queued: number;
  state: BillingState;
}

// Seals ended windows and posts every sealed, unposted row; failures stay queued for the next sync.
export async function syncBilling(manual: boolean): Promise<SyncResult> {
  const sealed = await sealWindows(manual);
  let posted = 0;
  const missing = await query<BillingWorkspace>(pool,
    "SELECT * FROM workspaces WHERE killbill_subscription_id IS NULL ORDER BY slug");
  const catalog = await one<{ catalog_uploaded: boolean }>(pool, "SELECT catalog_uploaded FROM billing_status WHERE id = 1");
  const pending = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM usage_rows WHERE billing_state = 'queued'");
  if (missing.length || !catalog?.catalog_uploaded || (pending?.n ?? 0) > 0) {
    try {
      await ensureCatalog();
      for (const ws of missing) await ensureAccount(ws);
      for (;;) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // A background sync skips rows another process is posting; a manual sync waits for them, so
          // it answers only once every row has been tried.
          const usage = await one<{ tracking_id: string; unit: string; window_start: Date; amount: string; workspace_id: string }>(client,
            `SELECT tracking_id, unit, window_start, amount::text AS amount, workspace_id FROM usage_rows
             WHERE billing_state = 'queued' ORDER BY window_start, tracking_id LIMIT 1 FOR UPDATE${manual ? "" : " SKIP LOCKED"}`);
          if (!usage) {
            await client.query("COMMIT");
            const left = manual ? await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM usage_rows WHERE billing_state = 'queued'") : undefined;
            if (!left?.n) break;
            continue;
          }
          const ws = await row<BillingWorkspace>(client, "SELECT * FROM workspaces WHERE id = $1", [usage.workspace_id]);
          await postRow(await ensureAccount(ws), usage);
          await client.query("UPDATE usage_rows SET billing_state = 'posted' WHERE tracking_id = $1", [usage.tracking_id]);
          await client.query("COMMIT");
          posted += 1;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
      await recordAttempt(true, null);
    } catch (error) {
      if (!(error instanceof KillBillUnreachable)) throw error;
      await recordAttempt(false, error.message);
      if (UNREADABLE_CATALOG.test(error.message)) await pool.query("UPDATE billing_status SET catalog_uploaded = false WHERE id = 1");
    }
  }
  const left = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM usage_rows WHERE billing_state = 'queued'");
  return { sealed, posted, queued: left?.n ?? 0, state: await billingState(null) };
}

type BillingState = "in_sync" | "pending" | "delayed";

// delayed when the most recent attempt to reach Kill Bill failed; otherwise pending while sealed rows
// are unposted; otherwise in_sync.
export async function billingState(workspaceId: string | null): Promise<BillingState> {
  const status = await one<{ last_attempt_ok: boolean | null }>(pool, "SELECT last_attempt_ok FROM billing_status WHERE id = 1");
  if (status?.last_attempt_ok === false) return "delayed";
  const queued = await one<{ n: number }>(pool,
    "SELECT count(*)::int AS n FROM usage_rows WHERE billing_state = 'queued' AND ($1::uuid IS NULL OR workspace_id = $1)", [workspaceId]);
  return (queued?.n ?? 0) > 0 ? "pending" : "in_sync";
}

export function startBillingWorker(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await syncBilling(false);
    } catch {
      // Postgres unavailable: the next tick retries.
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), config.billingSyncSeconds * 1000).unref();
}

// ---- Usage API (owner only) ----

const rowJson = (r: UsageRow): Record<string, unknown> => ({
  window_start: isoSecond(r.window_start), window_end: isoSecond(rowEnd(r)), bucket: r.bucket, unit: r.unit,
  amount: rowAmount(r), tracking_id: r.tracking_id, billing_state: r.billing_state,
});

export async function usageView(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const plan = planOf(m.workspace.plan_id);
  const period = periodOf(ctx.now);
  const totals = await workspaceTotals(pool, m.workspace.id);
  const month = await monthToDate(pool, m.workspace.id, period);
  const posted = await one<{ unposted: number; confirmed: Date | null }>(pool,
    `SELECT count(*) FILTER (WHERE billing_state = 'queued')::int AS unposted,
            max(window_end) FILTER (WHERE billing_state = 'posted') AS confirmed
     FROM usage_rows WHERE workspace_id = $1 AND to_char(window_start AT TIME ZONE 'UTC', 'YYYY-MM') = $2`, [m.workspace.id, period]);
  sendJson(ctx, 200, {
    period,
    plan: { id: plan.id, name: plan.name, included_storage_bytes: plan.includedStorageBytes, included_egress_bytes: plan.includedEgressBytes },
    stored_bytes: totals.stored_bytes, reserved_bytes: totals.reserved_bytes, quota_bytes: quotaBytes(plan.id),
    egress_bytes: month.egressBytes, request_units: month.requestUnits, storage_gb_hours: sumAmounts(month.storageAmounts),
    percent: { storage: percentOf(totals.stored_bytes, plan.includedStorageBytes), egress: percentOf(month.egressBytes, plan.includedEgressBytes) },
    billing: { state: await billingState(m.workspace.id), unposted_rows: posted?.unposted ?? 0, confirmed_through: isoOrNull(posted?.confirmed) },
  });
}

export async function usageRowsPage(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const cursor = ctx.query.get("cursor");
  if (cursor !== null && !/^[1-9]\d{0,8}$/.test(cursor)) throw invalid({ cursor: "This page link is no longer valid." });
  const offset = cursor ? Number(cursor) : 0;
  const rows = await usageRows(pool, m.workspace.id, periodOf(ctx.now), "newest");
  const page = rows.slice(offset, offset + 50);
  sendJson(ctx, 200, { rows: page.map(rowJson), next_cursor: rows.length > offset + 50 ? String(offset + 50) : null });
}

export async function usageExport(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const period = ctx.query.get("period") ?? periodOf(ctx.now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw invalid({ period: "Choose a month as YYYY-MM." });
  const rows = await usageRows(pool, m.workspace.id, period, "export");
  const lines = ["window_start_utc,window_end_utc,bucket,unit,amount,tracking_id,billing_state",
    ...rows.map((r) => [isoSecond(r.window_start), isoSecond(rowEnd(r)), r.bucket, r.unit, rowAmount(r), r.tracking_id, r.billing_state].join(","))];
  send(ctx, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="farshore-${m.workspace.slug}-${period}.csv"`,
    "Cache-Control": "private, no-store",
  }, `${lines.join("\n")}\n`);
}
