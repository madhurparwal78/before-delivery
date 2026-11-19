import { config } from "./config.js";

/** Kill Bill could not be reached, or answered something unusable. */
export class BillingUnavailable extends Error {}

const SEAT_PLAN = "lockset-seat-annual";
export const SEAT_PRICE_CENTS = 4800;

const base = `${config.killbillUrl}/1.0/kb`;
const auth = `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64")}`;

interface Answer {
  status: number;
  json: unknown;
}

async function call(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<Answer> {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: auth,
        "X-Killbill-ApiKey": config.killbillApiKey,
        "X-Killbill-ApiSecret": config.killbillApiSecret,
        "X-Killbill-CreatedBy": "lockset",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    throw new BillingUnavailable("Kill Bill cannot be reached");
  }
}

export interface Seat {
  subscriptionId: string;
  state: string;
  planName: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
}

interface SubscriptionJson {
  subscriptionId: string;
  state: string;
  planName: string;
  chargedThroughDate?: string | null;
  billingEndDate?: string | null;
}

function seatOf(json: SubscriptionJson): Seat {
  return {
    subscriptionId: json.subscriptionId,
    state: json.state,
    planName: json.planName,
    chargedThroughDate: json.chargedThroughDate ?? null,
    billingEndDate: json.billingEndDate ?? null,
  };
}

let accountId: string | null = null;

async function planExists(): Promise<boolean> {
  const answer = await call("GET", "/catalog/availableBasePlans");
  if (answer.status !== 200 || !Array.isArray(answer.json)) return false;
  return (answer.json as Array<{ plan?: string }>).some((plan) => plan.plan === SEAT_PLAN);
}

/** The tenant catalog holds the seat plan and the office account exists. Safe to repeat and to race. */
export async function ensureReady(): Promise<string> {
  if (accountId) return accountId;
  if (!(await planExists())) {
    await call("POST", "/catalog/simplePlan", {
      planId: SEAT_PLAN,
      productName: "Lockset-Seat",
      productCategory: "BASE",
      currency: "USD",
      amount: SEAT_PRICE_CENTS / 100,
      billingPeriod: "ANNUAL",
      trialLength: 0,
      trialTimeUnit: "DAYS",
      availableBaseProducts: [],
    });
    if (!(await planExists())) throw new BillingUnavailable("The seat plan is not in the catalog");
  }
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
  if (found.status === 200) {
    accountId = (found.json as { accountId: string }).accountId;
    return accountId;
  }
  if (found.status !== 404) throw new BillingUnavailable("Kill Bill could not look up the account");
  const created = await call("POST", "/accounts", {
    name: "Brannock & Lyle",
    externalKey: config.officeKey,
    currency: "USD",
  });
  if (created.status !== 201) {
    const again = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
    if (again.status !== 200) throw new BillingUnavailable("Kill Bill could not create the account");
    accountId = (again.json as { accountId: string }).accountId;
    return accountId;
  }
  const lookup = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
  if (lookup.status !== 200) throw new BillingUnavailable("Kill Bill could not read the new account");
  accountId = (lookup.json as { accountId: string }).accountId;
  return accountId;
}

function bundleKey(handle: string): string {
  return `${config.officeKey}-seat-${handle}`;
}

/** Looks the seat up by its bundle external key on the office account (cancelled bundles included). */
export async function findSeat(handle: string): Promise<Seat | null> {
  const account = await ensureReady();
  const answer = await call("GET", `/accounts/${account}/bundles?externalKey=${encodeURIComponent(bundleKey(handle))}`);
  if (answer.status !== 200 || !Array.isArray(answer.json)) throw new BillingUnavailable("Kill Bill could not look up the bundle");
  const bundles = answer.json as Array<{ subscriptions?: SubscriptionJson[] }>;
  const first = bundles.flatMap((bundle) => bundle.subscriptions ?? []).find((subscription) => subscription.planName === SEAT_PLAN);
  return first ? seatOf(first) : null;
}

/** Buys the seat unless its bundle already exists (a retry never makes a second subscription). */
export async function buySeat(handle: string): Promise<void> {
  const account = await ensureReady();
  if (await findSeat(handle)) return;
  const answer = await call("POST", "/subscriptions", {
    accountId: account,
    bundleExternalKey: bundleKey(handle),
    planName: SEAT_PLAN,
  });
  if (answer.status >= 400) throw new BillingUnavailable("Kill Bill refused the subscription");
}

export function purchaseConfirmed(seat: Seat | null): seat is Seat {
  return seat !== null && seat.state === "ACTIVE" && seat.chargedThroughDate !== null;
}

export function releaseConfirmed(seat: Seat | null): boolean {
  return (
    seat !== null &&
    seat.state === "CANCELLED" &&
    seat.billingEndDate !== null &&
    seat.chargedThroughDate !== null &&
    seat.billingEndDate.slice(0, 10) === seat.chargedThroughDate.slice(0, 10)
  );
}

/** Entitlement ends now; billing runs to the date already paid and never renews. */
export async function cancelSeat(subscriptionId: string): Promise<void> {
  const answer = await call(
    "DELETE",
    `/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM`,
  );
  if (answer.status >= 400 && answer.status !== 404) throw new BillingUnavailable("Kill Bill refused the cancellation");
}

/** The office account's ACTIVE seat subscriptions, and nothing from any other office. */
export async function activeSeats(): Promise<Seat[]> {
  const account = await ensureReady();
  const answer = await call("GET", `/accounts/${account}/bundles`);
  if (answer.status !== 200 || !Array.isArray(answer.json)) throw new BillingUnavailable("Kill Bill could not list seats");
  const bundles = answer.json as Array<{ subscriptions?: SubscriptionJson[] }>;
  return bundles
    .flatMap((bundle) => bundle.subscriptions ?? [])
    .filter((subscription) => subscription.planName === SEAT_PLAN && subscription.state === "ACTIVE")
    .map(seatOf);
}
