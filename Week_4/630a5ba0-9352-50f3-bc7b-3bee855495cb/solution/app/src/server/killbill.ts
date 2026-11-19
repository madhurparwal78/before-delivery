import { config, SERVICE_TIMEOUT_MS } from "./config.js";

// Kill Bill over HTTP with the environment's credentials. Every call is idempotent ("ensure …"),
// so a queued item retried after a timeout never creates a second account or seat.

const SEAT_PLAN = "daybook-seat-monthly";

export class BillingUnavailable extends Error {}

type Account = { accountId: string };
type Bundle = { externalKey: string; subscriptions: { subscriptionId: string; planName: string; state: string }[] | null };

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const kb = config.killbill;
  let response: Response;
  try {
    response = await fetch(`${kb.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${kb.username}:${kb.password}`).toString("base64")}`,
        "X-Killbill-ApiKey": kb.apiKey,
        "X-Killbill-ApiSecret": kb.apiSecret,
        "X-Killbill-CreatedBy": "tidemark-daybook",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailable("Kill Bill did not answer");
  }
  if (response.status >= 500) throw new BillingUnavailable(`Kill Bill answered ${response.status}`);
  return response;
}

function expect(response: Response, ...ok: number[]): Response {
  if (!ok.includes(response.status)) {
    throw new BillingUnavailable(`Kill Bill refused with ${response.status}`);
  }
  return response;
}

/** Adds the seat plan to the tenant catalog only when it is missing; never replaces a catalog. */
async function ensureCatalog(): Promise<void> {
  const response = expect(await call("GET", "/catalog"), 200);
  if ((await response.text()).includes(`"${SEAT_PLAN}"`)) return;
  expect(
    await call("POST", "/catalog/simplePlan", {
      planId: SEAT_PLAN,
      productName: "Daybook",
      productCategory: "BASE",
      currency: "USD",
      amount: 12.0,
      billingPeriod: "MONTHLY",
      trialLength: 14,
      trialTimeUnit: "DAYS",
      availableBaseProducts: [],
    }),
    201,
  );
}

async function findAccount(workspaceId: string): Promise<Account | null> {
  const response = expect(await call("GET", `/accounts?externalKey=${encodeURIComponent(workspaceId)}`), 200, 404);
  return response.status === 200 ? ((await response.json()) as Account) : null;
}

type WorkspaceAccount = { workspaceId: string; name: string; email: string };

async function ensureAccount(account: WorkspaceAccount): Promise<string> {
  const existing = await findAccount(account.workspaceId);
  if (existing) return existing.accountId;
  expect(
    await call("POST", "/accounts", { name: account.name, email: account.email, currency: "USD", externalKey: account.workspaceId }),
    201,
  );
  const created = await findAccount(account.workspaceId);
  if (!created) throw new BillingUnavailable("Kill Bill lost the new account");
  return created.accountId;
}

async function seatBundles(accountId: string, bundleKey: string): Promise<Bundle[]> {
  const response = expect(
    await call("GET", `/accounts/${accountId}/bundles?externalKey=${encodeURIComponent(bundleKey)}`),
    200,
    404,
  );
  return response.status === 200 ? ((await response.json()) as Bundle[]) : [];
}

const activeSeats = (bundles: Bundle[]) =>
  bundles.flatMap((b) => b.subscriptions ?? []).filter((s) => s.planName === SEAT_PLAN && s.state === "ACTIVE");

/** Makes sure the workspace account exists and holds one active seat subscription for the member. */
export async function ensureSeat(account: WorkspaceAccount, memberId: string): Promise<void> {
  await ensureCatalog();
  const accountId = await ensureAccount(account);
  const bundleKey = `${account.workspaceId}:${memberId}`;
  if (activeSeats(await seatBundles(accountId, bundleKey)).length > 0) return;
  expect(await call("POST", "/subscriptions", { accountId, bundleExternalKey: bundleKey, planName: SEAT_PLAN }), 201);
}

/** Cancels the member's seat immediately. Resolves only once Kill Bill confirmed. */
export async function cancelSeat(workspaceId: string, memberId: string): Promise<void> {
  const account = await findAccount(workspaceId);
  if (!account) return;
  for (const seat of activeSeats(await seatBundles(account.accountId, `${workspaceId}:${memberId}`))) {
    expect(
      await call("DELETE", `/subscriptions/${seat.subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE`),
      204,
      200,
    );
  }
}
