// Kill Bill over its REST API: the catalog, one account and one per-seat subscription per
// workspace, and the subscription's `seats` custom field, which is the confirmed seat limit.
import { randomInt } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const PLAN = "tallyroom-seat-monthly";
const TIMEOUT_MS = 5000;
const API_ROOT = "/1.0/kb";

/** The seat catalog. App copies sharing a tenant may upload at the same moment; each upload gets
 * its own effective date so concurrent uploads become separate, equally valid catalog versions. */
const catalog = (effective: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effective}</effectiveDate>
  <catalogName>tallyroom</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products><product name="Seat"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>
    <plan name="${PLAN}">
      <product>Seat</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>8.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans><plan>${PLAN}</plan></plans></defaultPriceList></priceLists>
</catalog>`;

interface KbResponse {
  status: number;
  text: string;
  location: string | null;
}

/** The 5-second budget of one Kill Bill exchange, shared by all its calls. */
export function billingDeadline(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function call(method: string, path: string, body?: string, contentType = "application/json", signal: AbortSignal = billingDeadline()): Promise<KbResponse> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "tallyroom",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body,
      signal,
    });
  } catch {
    throw new ApiError("billing_unavailable");
  }
  const text = await response.text();
  if (response.status >= 500 || response.status === 401) throw new ApiError("billing_unavailable");
  return { status: response.status, text, location: response.headers.get("location") };
}

function parse<T>(response: KbResponse): T {
  if (response.status >= 300) throw new ApiError("billing_unavailable");
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new ApiError("billing_unavailable");
  }
}

/** Billing is reachable when the tenant answers an authenticated read. */
export async function killbillReachable(): Promise<boolean> {
  try {
    return (await call("GET", "/catalog/versions")).status === 200;
  } catch {
    return false;
  }
}

/** Uploads the seat catalog unless the tenant already has the plan. */
export async function ensureCatalog(): Promise<void> {
  const existing = await call("GET", "/catalog");
  if (existing.status === 200 && existing.text.includes(PLAN)) return;
  const effective = new Date(Date.UTC(2020, 0, 1) + randomInt(0, 86_400) * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const uploaded = await call("POST", "/catalog/xml", catalog(effective), "text/xml");
  if (uploaded.status >= 300) throw new ApiError("billing_unavailable");
}

interface Account {
  accountId: string;
}

interface Bundle {
  externalKey: string;
  subscriptions: { subscriptionId: string; planName: string }[];
}

interface CustomField {
  customFieldId: string;
  objectId: string;
  objectType: string;
  name: string;
  value: string;
}

async function accountByKey(externalKey: string): Promise<Account | null> {
  const response = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  return parse<Account>(response);
}

/** Ensures the account `tallyroom-<id>` and its one seat subscription; returns their ids. */
export async function ensureSubscription(workspaceId: string, workspaceName: string): Promise<{ accountId: string; subscriptionId: string }> {
  const accountKey = `tallyroom-${workspaceId}`;
  let account = await accountByKey(accountKey);
  if (!account) {
    await call("POST", "/accounts", JSON.stringify({ name: workspaceName, externalKey: accountKey, currency: "USD" }));
    account = await accountByKey(accountKey);
    if (!account) throw new ApiError("billing_unavailable");
  }
  const bundleKey = `${accountKey}-seats`;
  const findSubscription = async (): Promise<string | undefined> => {
    const bundles = parse<Bundle[]>(await call("GET", `/accounts/${account.accountId}/bundles`));
    return bundles.find((b) => b.externalKey === bundleKey)?.subscriptions.find((s) => s.planName === PLAN)?.subscriptionId;
  };
  let subscriptionId = await findSubscription();
  if (!subscriptionId) {
    const created = await call("POST", "/subscriptions", JSON.stringify({ accountId: account.accountId, bundleExternalKey: bundleKey, planName: PLAN }));
    if (created.status >= 300) throw new ApiError("billing_unavailable");
    subscriptionId = await findSubscription();
    if (!subscriptionId) throw new ApiError("billing_unavailable");
  }
  return { accountId: account.accountId, subscriptionId };
}

/** Kill Bill no longer knows a subscription id the app kept; the caller resolves it again. */
export class MissingSubscription extends Error {}

export interface SeatFields {
  seats: number;
  scheduled: { limit: number; on: string } | null;
}

async function customFields(subscriptionId: string, signal?: AbortSignal): Promise<CustomField[]> {
  const response = await call("GET", `/subscriptions/${subscriptionId}/customFields`, undefined, undefined, signal);
  if (response.status === 404) throw new MissingSubscription(subscriptionId);
  return parse<CustomField[]>(response);
}

async function writeField(subscriptionId: string, name: string, value: string, signal?: AbortSignal): Promise<void> {
  const existing = (await customFields(subscriptionId, signal)).find((f) => f.name === name);
  const path = `/subscriptions/${subscriptionId}/customFields`;
  const response = existing
    ? await call("PUT", path, JSON.stringify([{ customFieldId: existing.customFieldId, objectId: subscriptionId, objectType: "SUBSCRIPTION", name, value }]), undefined, signal)
    : await call("POST", path, JSON.stringify([{ name, value }]), undefined, signal);
  if (response.status === 404) throw new MissingSubscription(subscriptionId);
  if (response.status >= 300) throw new ApiError("billing_unavailable");
}

/** Gives the subscription its `seats` field, set to `initial`, unless it has one. Callers hold the
 * workspace's billing lock so app copies sharing the workspace never create two. */
export async function ensureSeatsField(subscriptionId: string, initial: number): Promise<void> {
  if ((await customFields(subscriptionId)).some((f) => f.name === "seats")) return;
  await writeField(subscriptionId, "seats", String(initial));
}

function parseScheduled(value: string | undefined): SeatFields["scheduled"] {
  const match = /^(\d+)@(\d{4}-\d{2}-\d{2})$/.exec(value ?? "");
  return match ? { limit: Number(match[1]), on: match[2] as string } : null;
}

/** The confirmed seat limit and any scheduled reduction, as Kill Bill holds them now. */
export async function readSeatFields(subscriptionId: string, signal?: AbortSignal): Promise<SeatFields> {
  const fields = await customFields(subscriptionId, signal);
  const seats = Number(fields.find((f) => f.name === "seats")?.value);
  if (!Number.isInteger(seats) || seats < 0) throw new MissingSubscription(subscriptionId);
  return { seats, scheduled: parseScheduled(fields.find((f) => f.name === "seats_scheduled")?.value) };
}

/** Rewrites `seats` and removes any `seats_scheduled`, then returns what Kill Bill reads back. */
export async function writeSeats(subscriptionId: string, seats: number, signal?: AbortSignal): Promise<SeatFields> {
  await writeField(subscriptionId, "seats", String(seats), signal);
  return clearSchedule(subscriptionId, signal);
}

export async function clearSchedule(subscriptionId: string, signal?: AbortSignal): Promise<SeatFields> {
  const existing = (await customFields(subscriptionId, signal)).find((f) => f.name === "seats_scheduled");
  if (existing) {
    const response = await call("DELETE", `/subscriptions/${subscriptionId}/customFields?customField=${existing.customFieldId}`, undefined, undefined, signal);
    if (response.status >= 300) throw new ApiError("billing_unavailable");
  }
  return readSeatFields(subscriptionId, signal);
}

/** Stores a reduction for the charged-through date, which only Kill Bill can name. */
export async function scheduleSeats(subscriptionId: string, seats: number, signal?: AbortSignal): Promise<SeatFields> {
  const { chargedThroughDate } = parse<{ chargedThroughDate: string | null }>(await call("GET", `/subscriptions/${subscriptionId}`, undefined, undefined, signal));
  if (!chargedThroughDate) throw new ApiError("billing_unavailable");
  await writeField(subscriptionId, "seats_scheduled", `${seats}@${chargedThroughDate.slice(0, 10)}`, signal);
  return readSeatFields(subscriptionId, signal);
}
