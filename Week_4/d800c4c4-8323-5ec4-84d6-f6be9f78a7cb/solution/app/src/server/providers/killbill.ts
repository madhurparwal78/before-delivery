// Kill Bill: the one ledger for memberships and fees. Every call is authenticated from the environment.
import { config } from "../config.js";
import { providerFetch } from "./status.js";

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__";

export const PLANS = {
  "pay-what-you-can": { product: "PayWhatYouCan", plan: "pegworth-pay-what-you-can-annual", price: "15.00" },
  standard: { product: "Standard", plan: "pegworth-standard-annual", price: "40.00" },
  supporter: { product: "Supporter", plan: "pegworth-supporter-annual", price: "75.00" },
} as const;
export type Tier = keyof typeof PLANS;

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}
interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  billingEndDate: string | null;
  chargedThroughDate: string | null;
}
interface KbInvoiceItem {
  invoiceItemId: string;
  itemType: string;
  description: string;
  amount: number;
  subscriptionId: string | null;
  linkedInvoiceItemId: string | null;
}
interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  balance: number;
  amount: number;
  items: KbInvoiceItem[];
}
interface KbTransaction {
  transactionType: string;
  status: string;
}
interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  targetInvoiceId?: string;
  transactions: KbTransaction[];
}

async function call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<Response> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  const response = await providerFetch("billing", `${config.killbill.url}/1.0/kb${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "pegworth-desk",
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": contentType }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return response;
}

async function ok(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what}: Kill Bill answered ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await ok(await call(method, path, body), `${method} ${path}`)).json()) as T;
}

/** Kill Bill takes decimal amounts; cents become an exact two-decimal number at this edge only. */
const amount = (cents: number) => cents / 100;
const idFrom = (response: Response) => response.headers.get("location")!.replace(/\/+$/, "").split("/").pop()!;

/** Any answer from Kill Bill means it is reachable; `call` marks it down on a network failure. */
export async function probeBilling(): Promise<void> {
  await (await call("GET", "/catalog/versions")).arrayBuffer();
}

/** On serve: if the tenant has no catalog, upload the three membership plans (callers hold the catalog lock). */
export async function ensureCatalog(): Promise<void> {
  const catalogs = await json<unknown[]>("GET", "/catalog");
  if (catalogs.length > 0) return;
  const plans = Object.values(PLANS);
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Pegworth</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>${plans.map((p) => `<product name="${p.product}"><category>BASE</category></product>`).join("")}</products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${plans
    .map(
      (p) => `<plan name="${p.plan}"><product>${p.product}</product><finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
      <recurring><billingPeriod>ANNUAL</billingPeriod><recurringPrice><price><currency>USD</currency><value>${p.price}</value></price></recurringPrice></recurring>
      </finalPhase></plan>`,
    )
    .join("")}</plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${plans.map((p) => `<plan>${p.plan}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
  await ok(await call("POST", "/catalog/xml", xml, "text/xml"), "catalog upload");
}

/** The member's one Kill Bill account (external key = lowercased email), reused when it exists, with an
 * external default payment method and automatic payment turned off. */
export async function ensureAccount(name: string, email: string): Promise<string> {
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(email)}`);
  let account: KbAccount;
  if (found.status === 404) {
    const created = await ok(await call("POST", "/accounts", { name, email, externalKey: email, currency: "USD" }), "create account");
    account = { accountId: idFrom(created), paymentMethodId: null };
  } else {
    account = (await (await ok(found, "find account")).json()) as KbAccount;
  }
  if (!account.paymentMethodId) {
    await ok(
      await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PLUGIN }),
      "add payment method",
    );
  }
  const tags = await json<Array<{ tagDefinitionId: string }>>("GET", `/accounts/${account.accountId}/tags`);
  if (!tags.some((t) => t.tagDefinitionId === AUTO_PAY_OFF)) {
    await ok(await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF]), "tag AUTO_PAY_OFF");
  }
  return account.accountId;
}

/** The account's active subscription to the tier's plan, reused when it exists. */
export async function ensureSubscription(accountId: string, tier: Tier): Promise<string> {
  const plan = PLANS[tier].plan;
  const bundles = await json<Array<{ subscriptions: KbSubscription[] }>>("GET", `/accounts/${accountId}/bundles`);
  const existing = bundles.flatMap((b) => b.subscriptions).find((s) => s.planName === plan && s.state === "ACTIVE");
  if (existing) return existing.subscriptionId;
  return idFrom(await ok(await call("POST", "/subscriptions", { accountId, planName: plan }), "create subscription"));
}

async function successfulPayments(invoiceId: string): Promise<number> {
  const payments = await json<KbPayment[]>("GET", `/invoices/${invoiceId}/payments`);
  return payments.filter((p) => p.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS")).length;
}

/** Pays the subscription's first invoice once it exists (reusing a successful payment already on it) and
 * reports whether Kill Bill now shows the subscription ACTIVE with that invoice paid. */
export async function settleFirstInvoice(accountId: string, subscriptionId: string): Promise<boolean> {
  const invoices = await json<KbInvoice[]>("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  const first = invoices.find((i) => i.items.some((it) => it.itemType === "RECURRING" && it.subscriptionId === subscriptionId));
  if (!first) return false;
  let paid = (await successfulPayments(first.invoiceId)) > 0;
  if (!paid && first.balance > 0) {
    await ok(
      await call("POST", `/invoices/${first.invoiceId}/payments?externalPayment=true`, { accountId, purchasedAmount: first.balance }),
      "pay first invoice",
    );
    paid = true;
  }
  const subscription = await json<KbSubscription>("GET", `/subscriptions/${subscriptionId}`);
  const now = await json<KbInvoice>("GET", `/invoices/${first.invoiceId}`);
  return paid && subscription.state === "ACTIVE" && Number(now.balance) === 0;
}

/** Cancels at end of term and returns the billing end date Kill Bill reports. */
export async function cancelAtEndOfTerm(subscriptionId: string): Promise<string> {
  await ok(
    await call("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM`),
    "cancel subscription",
  );
  const subscription = await json<KbSubscription>("GET", `/subscriptions/${subscriptionId}`);
  return (subscription.billingEndDate ?? subscription.chargedThroughDate)!.slice(0, 10);
}

/** One invoice with one external charge per fee line, in order. */
export async function raiseCharges(
  accountId: string,
  lines: ReadonlyArray<{ description: string; amount_cents: number }>,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const items = await json<Array<{ invoiceId: string }>>(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    lines.map((line) => ({ accountId, amount: amount(line.amount_cents), currency: "USD", description: line.description })),
  );
  const invoice = await json<KbInvoice>("GET", `/invoices/${items[0]!.invoiceId}`);
  return { invoiceId: invoice.invoiceId, invoiceNumber: String(invoice.invoiceNumber) };
}

/** Pays a fee's invoice once: an earlier successful payment with the fee's key is reused. */
export async function payFeeInvoice(accountId: string, invoiceId: string, paymentKey: string): Promise<void> {
  const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(paymentKey)}`);
  const payment = existing.status === 404 ? null : ((await (await ok(existing, "find payment")).json()) as KbPayment);
  const succeeded = payment?.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS") ?? false;
  if (!succeeded) {
    const invoice = await json<KbInvoice>("GET", `/invoices/${invoiceId}`);
    await ok(
      await call("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, {
        accountId,
        purchasedAmount: invoice.balance,
        paymentExternalKey: paymentKey,
      }),
      "pay fee",
    );
  }
}

/** Credits a fee's invoice back to zero with adjustments described `Waiver for fee <id>`; adjustments already
 * posted by an earlier attempt are found on the invoice and not posted again. */
export async function creditFeeInvoice(accountId: string, invoiceId: string, description: string): Promise<void> {
  const invoice = await json<KbInvoice>("GET", `/invoices/${invoiceId}?withItems=true`);
  const credited = new Set(invoice.items.filter((it) => it.description === description).map((it) => it.linkedInvoiceItemId));
  for (const item of invoice.items.filter((it) => it.itemType === "EXTERNAL_CHARGE" && !credited.has(it.invoiceItemId))) {
    await ok(
      await call("POST", `/invoices/${invoiceId}`, {
        invoiceItemId: item.invoiceItemId,
        accountId,
        amount: item.amount,
        currency: "USD",
        description,
      }),
      "credit fee",
    );
  }
}
