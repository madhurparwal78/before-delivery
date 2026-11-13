/** Kill Bill: the Archive plan catalogue, the author's account and its subscription. */

import { config } from "../config.js";
import { DependencyDown } from "../errors.js";
import { formatMoney } from "../../shared/sizes.js";
import { roundRatio } from "../../shared/decimal.js";
import { isPlanId, PLANS, planDefinition } from "../../shared/plans.js";
import type { PlanId } from "../../shared/model.js";

const ACCOUNT_EXTERNAL_KEY = "perilune-author";
const BUNDLE_EXTERNAL_KEY = "perilune-archive";
const CATALOGUE_NAME = "perilune-archive";
const CATALOGUE_EFFECTIVE_DATE = "2026-01-01T00:00:00+00:00";
const CONFIRM_TIMEOUT_MS = 10_000;
const INVOICE_WAIT_MS = 5_000;
const CALL_TIMEOUT_MS = 3000;

function headers(write: boolean): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    "base64",
  );
  const base: Record<string, string> = {
    Authorization: `Basic ${basic}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    Accept: "application/json",
  };
  if (write) {
    base["X-Killbill-CreatedBy"] = "perilune-ledger";
  }
  return base;
}

type BillingCall = {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  contentType?: string;
};

async function call(request: BillingCall): Promise<{status: number; ok: boolean; body: unknown}> {
  const write = request.method !== "GET";
  try {
    const response = await fetch(`${config.killbill.url}${request.path}`, {
      method: request.method,
      headers: {
        ...headers(write),
        ...(request.body === undefined
          ? {}
          : { "Content-Type": request.contentType ?? "application/json" }),
      },
      body:
        request.body === undefined
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await response.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : null;
    return {status: response.status, ok: response.ok, body};
  } catch (error) {
    throw new DependencyDown("billing", String(error));
  }
}

export async function probeBilling(): Promise<boolean> {
  try {
    const response = await call({ method: "GET", path: "/1.0/kb/test/clock" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function catalogueXml(): string {
  const plans = PLANS.map((plan) => {
    const period = plan.period === "month" ? "MONTHLY" : "ANNUAL";
    const price = formatMoney(plan.price_cents);
    return `    <plan name="${plan.plan}">
      <product>archive</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>${period}</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
  }).join("\n");
  const priceListPlans = PLANS.map((plan) => `        <plan>${plan.plan}</plan>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${CATALOGUE_EFFECTIVE_DATE}</effectiveDate>
  <catalogName>${CATALOGUE_NAME}</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="archive"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
${plans}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${priceListPlans}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}

export async function ensureCatalogue(): Promise<void> {
  const existing = await call({ method: "GET", path: "/1.0/kb/catalog" });
  if (existing.ok) {
    const versions = existing.body as
      | { name?: string; effectiveDate?: string }[]
      | null;
    const held = (versions ?? []).some(
      (version) =>
        version.name === CATALOGUE_NAME &&
        (version.effectiveDate ?? "").startsWith("2026-01-01"),
    );
    if (held) {
      return;
    }
  }
  const uploaded = await call({
    method: "POST",
    path: "/1.0/kb/catalog/xml",
    body: catalogueXml(),
    contentType: "text/xml",
  });
  if (!uploaded.ok) {
    throw new DependencyDown("billing", `catalogue upload failed: ${uploaded.status}`);
  }
}

type Account = { accountId: string; accountBalance?: number };

async function findAccount(): Promise<Account | null> {
  const response = await call({
    method: "GET",
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(
      ACCOUNT_EXTERNAL_KEY,
    )}&accountWithBalance=true`,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new DependencyDown("billing", `account read failed: ${response.status}`);
  }
  return response.body as Account | null;
}

async function createAccount(): Promise<Account> {
  const response = await call({
    method: "POST",
    path: "/1.0/kb/accounts",
    body: { externalKey: ACCOUNT_EXTERNAL_KEY, name: "Perilune Ledger author", currency: "USD" },
  });
  if (!response.ok) {
    throw new DependencyDown("billing", `account create failed: ${response.status}`);
  }
  const account = await findAccount();
  if (!account) {
    throw new DependencyDown("billing", "account not visible after creation");
  }
  return account;
}

type Subscription = {
  subscriptionId: string;
  planName?: string;
  chargedThroughDate?: string | null;
  productCategory?: string;
  state?: string;
};

type Bundle = { externalKey?: string; subscriptions?: Subscription[] };

async function findSubscription(accountId: string): Promise<Subscription | null> {
  const response = await call({
    method: "GET",
    path: `/1.0/kb/accounts/${accountId}/bundles`,
  });
  if (!response.ok) {
    throw new DependencyDown("billing", `bundles read failed: ${response.status}`);
  }
  const bundles = (response.body as Bundle[] | null) ?? [];
  for (const bundle of bundles) {
    for (const subscription of bundle.subscriptions ?? []) {
      if (subscription.productCategory === "BASE" && subscription.state !== "CANCELLED") {
        return subscription;
      }
    }
  }
  return null;
}

type BillingSnapshot = {
  plan: PlanId | null;
  nextBillingDate: string | null;
  balanceCents: number | null;
};

export async function readBilling(): Promise<BillingSnapshot> {
  const account = await findAccount();
  if (!account) {
    return { plan: null, nextBillingDate: null, balanceCents: 0 };
  }
  const subscription = await findSubscription(account.accountId);
  const plan = subscription && isPlanId(subscription.planName) ? subscription.planName : null;
  // Read after the subscription: its charged-through date appears once billing has committed the invoice.
  const balance = (await findAccount())?.accountBalance ?? 0;
  return {
    plan,
    nextBillingDate: subscription?.chargedThroughDate ?? null,
    balanceCents: roundRatio(balance, 100n, 1n),
  };
}

async function invoiceCount(accountId: string): Promise<number | null> {
  const response = await call({ method: "GET", path: `/1.0/kb/accounts/${accountId}/invoices` });
  return response.ok && Array.isArray(response.body) ? response.body.length : null;
}

/** Billing posts a plan change's invoice just after confirming it; the balance is not final until then. */
async function settleInvoice(accountId: string, before: number | null): Promise<void> {
  const deadline = Date.now() + INVOICE_WAIT_MS;
  while (before !== null && Date.now() < deadline) {
    const count = await invoiceCount(accountId);
    if (count === null || count > before) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Moves the subscription to `plan` and waits for billing to confirm it. */
export async function applyPlan(plan: PlanId): Promise<BillingSnapshot> {
  const definition = planDefinition(plan);
  const account = (await findAccount()) ?? (await createAccount());
  const subscription = await findSubscription(account.accountId);
  const invoicesBefore = await invoiceCount(account.accountId);
  if (!subscription) {
    const created = await call({
      method: "POST",
      path: "/1.0/kb/subscriptions",
      body: {
        accountId: account.accountId,
        bundleExternalKey: BUNDLE_EXTERNAL_KEY,
        planName: definition.plan,
      },
    });
    if (!created.ok) {
      throw new DependencyDown("billing", `subscription create failed: ${created.status}`);
    }
  } else {
    const changed = await call({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscription.subscriptionId}?billingPolicy=IMMEDIATE`,
      body: { subscriptionId: subscription.subscriptionId, planName: definition.plan },
    });
    if (!changed.ok) {
      throw new DependencyDown("billing", `plan change failed: ${changed.status}`);
    }
  }
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    const snapshot = await readBilling();
    if (snapshot.plan === plan && snapshot.nextBillingDate !== null) {
      await settleInvoice(account.accountId, invoicesBefore);
      return readBilling();
    }
    if (Date.now() >= deadline) {
      throw new DependencyDown("billing", "plan change not confirmed");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
