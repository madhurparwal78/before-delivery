import type { Config } from "./env.ts";
import { nowMs } from "./clock.ts";

export interface BillingState {
  limit: number;
  chargedThrough: string | null;
  scheduledLimit: number | null;
  scheduledOn: string | null;
  subscriptionId: string | null;
}

interface CacheEntry {
  at: number;
  state: BillingState;
}

const cache = new Map<string, CacheEntry>();

export class BillingUnavailable extends Error {}

function authHeaders(cfg: Config, createdBy: string): Record<string, string> {
  return {
    "X-Killbill-ApiKey": cfg.killbillApiKey,
    "X-Killbill-ApiSecret": cfg.killbillApiSecret,
    "X-Killbill-CreatedBy": createdBy,
    "Content-Type": "application/json",
  };
}

function basic(cfg: Config): string {
  return "Basic " + Buffer.from(`${cfg.killbillUsername}:${cfg.killbillPassword}`).toString("base64");
}

async function kbFetch(
  cfg: Config,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 5000
): Promise<{ status: number; json: any; location: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.killbillUrl}/1.0/kb${path}`, {
      method,
      headers: { ...authHeaders(cfg, "tallyroom"), Authorization: basic(cfg) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let json: any = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    return { status: res.status, json, location: res.headers.get("location") };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureCatalog(cfg: Config): Promise<void> {
  const res = await kbFetch(cfg, "GET", `/catalog/plans/tallyroom-seat-monthly`);
  if (res.status === 404) {
    const create = await kbFetch(cfg, "POST", "/catalog/simplePlan", {
      planId: "tallyroom-seat-monthly",
      productName: "Seat",
      currency: "USD",
      amount: 8,
      billingPeriod: "MONTHLY",
      trialLength: 0,
      trialTimeUnit: "DAYS",
      productCategory: "BASE",
    });
    if (create.status !== 201) throw new BillingUnavailable("catalog");
  } else if (res.status >= 500) {
    throw new BillingUnavailable("catalog");
  }
}

export async function registerCatalog(cfg: Config): Promise<void> {
  await ensureCatalog(cfg);
}

async function ensureAccount(cfg: Config, workspaceId: string, workspaceName: string): Promise<string> {
  const externalKey = `tallyroom-${workspaceId}`;
  const res = await kbFetch(cfg, "GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  const found = accountFrom(res);
  if (found) return found;
  const create = await kbFetch(cfg, "POST", "/accounts", {
    name: workspaceName,
    externalKey,
    currency: "USD",
  });
  if (create.status === 201 && typeof create.location === "string" && create.location) {
    return create.location.split("/").pop() ?? "";
  }
  const again = await kbFetch(cfg, "GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  const foundAgain = accountFrom(again);
  if (foundAgain) return foundAgain;
  throw new BillingUnavailable("account");
}

/** Kill Bill answers with one account object, or nothing at all when the key is unknown. */
function accountFrom(res: { status: number; json: any }): string | null {
  if (res.status !== 200 || !res.json) return null;
  const json = res.json;
  if (Array.isArray(json)) {
    return json.length > 0 && json[0].accountId ? json[0].accountId : null;
  }
  return json.accountId ? json.accountId : null;
}

interface SubscriptionInfo {
  subscriptionId: string;
  bundleExternalKey: string;
  chargedThroughDate: string | null;
  customFields: { name: string; value: string }[];
}

async function findSubscription(cfg: Config, bundleKey: string): Promise<SubscriptionInfo | null> {
  const res = await kbFetch(cfg, "GET", `/subscriptions?externalKey=${encodeURIComponent(bundleKey)}`);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.json || !res.json.subscriptionId) throw new BillingUnavailable("subscription");
  const sub = res.json;
  const fields = await kbFetch(cfg, "GET", `/subscriptions/${sub.subscriptionId}/customFields`);
  if (fields.status !== 200) throw new BillingUnavailable("customFields");
  return {
    subscriptionId: sub.subscriptionId,
    bundleExternalKey: bundleKey,
    chargedThroughDate: sub.chargedThroughDate ?? null,
    customFields: (fields.json as any[]).map((f) => ({ name: f.name, value: f.value })),
  };
}

async function ensureSubscription(
  cfg: Config,
  accountId: string,
  bundleKey: string,
  initialSeats: number
): Promise<SubscriptionInfo> {
  const existing = await findSubscription(cfg, bundleKey);
  if (existing) return existing;
  const create = await kbFetch(cfg, "POST", "/subscriptions?createSubEntitlementWithAddOns=false", {
    accountId,
    externalKey: bundleKey,
    planName: "tallyroom-seat-monthly",
  });
  if (create.status !== 201) throw new BillingUnavailable("subscription");
  const info = await findSubscription(cfg, bundleKey);
  if (!info) throw new BillingUnavailable("subscription");
  await writeCustomField(cfg, info.subscriptionId, "seats", String(initialSeats));
  return info;
}

/** Write a custom field: Kill Bill replaces a value by delete-then-create. */
async function writeCustomField(cfg: Config, subscriptionId: string, name: string, value: string): Promise<void> {
  const fields = await kbFetch(cfg, "GET", `/subscriptions/${subscriptionId}/customFields`);
  if (fields.status !== 200) {
    throw new BillingUnavailable("customField");
  }
  const rows = ((fields.json as any[]) || []).filter((f) => f.name === name);
  for (const row of rows) {
    if (row.customFieldId) await deleteCustomField(cfg, subscriptionId, row.customFieldId);
  }
  // Kill Bill can still see a just-deleted field; retry the create until it lands.
  let created = false;
  for (let attempt = 0; attempt < 10 && !created; attempt++) {
    const res = await kbFetch(cfg, "POST", `/subscriptions/${subscriptionId}/customFields`, [{ name, value }]);
    if (res.status === 201 || res.status === 200 || res.status === 204) {
      created = true;
      break;
    }
    if (res.status !== 400) throw new BillingUnavailable("customField");
    await sleep(250);
  }
  if (!created) throw new BillingUnavailable("customField");
  // The written value must be readable back before it counts.
  for (let attempt = 0; attempt < 12; attempt++) {
    const readBack = await kbFetch(cfg, "GET", `/subscriptions/${subscriptionId}/customFields`);
    if (readBack.status !== 200) throw new BillingUnavailable("customField");
    const matching = ((readBack.json as any[]) || []).filter((f) => f.name === name);
    if (matching.length === 1 && matching[0].value === value) return;
    await sleep(250);
  }
  throw new BillingUnavailable("customField");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteCustomField(cfg: Config, subscriptionId: string, customFieldId: string): Promise<void> {
  const res = await kbFetch(cfg, "DELETE", `/subscriptions/${subscriptionId}/customFields?customField=${customFieldId}`);
  if (res.status !== 200 && res.status !== 204) throw new BillingUnavailable("customField");
}

async function ensureWorkspaceAccount(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  initialSeats: number
): Promise<{ accountId: string; subscriptionId: string; bundleKey: string }> {
  const accountId = await ensureAccount(cfg, workspaceId, workspaceName);
  const bundleKey = `tallyroom-${workspaceId}-seats`;
  const info = await ensureSubscription(cfg, accountId, bundleKey, initialSeats);
  return { accountId, subscriptionId: info.subscriptionId, bundleKey };
}

/** Read the confirmed state for a workspace, refreshing the cache when older than 10s. */
export async function readBillingState(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  initialSeats: number
): Promise<BillingState> {
  const cached = cache.get(workspaceId);
  if (cached && nowMs() - cached.at < 10000) return cached.state;
  const state = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  cache.set(workspaceId, { at: nowMs(), state });
  return state;
}

async function freshRead(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  initialSeats: number
): Promise<BillingState> {
  let info = await findSubscription(cfg, `tallyroom-${workspaceId}-seats`);
  if (!info) {
    // The subscription has never been registered: create it once, then read back.
    const { subscriptionId } = await ensureWorkspaceAccount(cfg, workspaceId, workspaceName, initialSeats);
    info = (await findSubscription(cfg, `tallyroom-${workspaceId}-seats`)) ?? null;
    if (!info) {
      void subscriptionId;
      throw new BillingUnavailable("subscription");
    }
  }
  const seatsField = info.customFields.find((f) => f.name === "seats");
  const scheduledField = info.customFields.find((f) => f.name === "seats_scheduled");
  const limit = seatsField ? Number(seatsField.value) : initialSeats;
  let scheduledLimit: number | null = null;
  let scheduledOn: string | null = null;
  if (scheduledField) {
    const at = scheduledField.value.indexOf("@");
    if (at > 0) {
      const n = Number(scheduledField.value.slice(0, at));
      const date = scheduledField.value.slice(at + 1);
      if (Number.isFinite(n)) {
        scheduledLimit = n;
        scheduledOn = date;
      }
    }
  }
  return {
    limit: Number.isFinite(limit) ? limit : initialSeats,
    chargedThrough: info.chargedThroughDate ?? null,
    scheduledLimit,
    scheduledOn,
    subscriptionId: info.subscriptionId,
  };
}

/** Apply a due scheduled reduction, writing seats and clearing the schedule. */
export async function applyScheduledReduction(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  initialSeats: number,
  todayDate: string
): Promise<BillingState> {
  const state = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  if (state.scheduledLimit === null || state.scheduledOn === null) return state;
  if (state.scheduledOn > todayDate) {
    cache.set(workspaceId, { at: nowMs(), state });
    return state;
  }
  const subscriptionId = state.subscriptionId ?? (await ensureWorkspaceAccount(cfg, workspaceId, workspaceName, initialSeats)).subscriptionId;
  await writeCustomField(cfg, subscriptionId, "seats", String(state.scheduledLimit));
  const fields = await kbFetch(cfg, "GET", `/subscriptions/${subscriptionId}/customFields`);
  const scheduled = ((fields.json as any[]) || []).find((f) => f.name === "seats_scheduled");
  if (scheduled?.customFieldId) {
    await deleteCustomField(cfg, subscriptionId, scheduled.customFieldId);
  }
  const after = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  cache.set(workspaceId, { at: nowMs(), state: after });
  return after;
}

/** Raise (or set) the confirmed seat limit; clears any schedule. Returns the new state. */
export async function raiseSeats(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  seats: number,
  initialSeats: number
): Promise<BillingState> {
  const current = await readBillingState(cfg, workspaceId, workspaceName, initialSeats);
  const subscriptionId =
    current.subscriptionId ?? (await ensureWorkspaceAccount(cfg, workspaceId, workspaceName, initialSeats)).subscriptionId;
  await writeCustomField(cfg, subscriptionId, "seats", String(seats));
  const fields = await kbFetch(cfg, "GET", `/subscriptions/${subscriptionId}/customFields`);
  const scheduled = ((fields.json as any[]) || []).find((f) => f.name === "seats_scheduled");
  if (scheduled?.customFieldId) {
    await deleteCustomField(cfg, subscriptionId, scheduled.customFieldId);
  }
  const state = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  cache.set(workspaceId, { at: nowMs(), state });
  return state;
}

/** Schedule a reduction for the charged-through date. */
export async function scheduleReduction(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  seats: number,
  initialSeats: number
): Promise<BillingState> {
  const state = await readBillingState(cfg, workspaceId, workspaceName, initialSeats);
  if (!state.chargedThrough) throw new BillingUnavailable("chargedThrough");
  const value = `${seats}@${state.chargedThrough}`;
  const subscriptionId =
    state.subscriptionId ?? (await ensureWorkspaceAccount(cfg, workspaceId, workspaceName, initialSeats)).subscriptionId;
  await writeCustomField(cfg, subscriptionId, "seats_scheduled", value);
  const after = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  cache.set(workspaceId, { at: nowMs(), state: after });
  return after;
}

/** Request the current limit: clears any schedule and returns the state. */
export async function clearSchedule(
  cfg: Config,
  workspaceId: string,
  workspaceName: string,
  initialSeats: number
): Promise<BillingState> {
  const current = await readBillingState(cfg, workspaceId, workspaceName, initialSeats);
  const subscriptionId =
    current.subscriptionId ?? (await ensureWorkspaceAccount(cfg, workspaceId, workspaceName, initialSeats)).subscriptionId;
  const fields = await kbFetch(cfg, "GET", `/subscriptions/${subscriptionId}/customFields`);
  const scheduled = ((fields.json as any[]) || []).find((f) => f.name === "seats_scheduled");
  if (scheduled?.customFieldId) {
    await deleteCustomField(cfg, subscriptionId, scheduled.customFieldId);
  }
  const state = await freshRead(cfg, workspaceId, workspaceName, initialSeats);
  cache.set(workspaceId, { at: nowMs(), state });
  return state;
}

/** Fall back to the last known state when Kill Bill is unreachable. */
export function lastKnown(workspaceId: string, fallback: number): BillingState {
  const cached = cache.get(workspaceId);
  if (cached) return cached.state;
  return { limit: fallback, chargedThrough: null, scheduledLimit: null, scheduledOn: null, subscriptionId: null };
}
