// Kill Bill: payer accounts, external-charge invoices, PURCHASE payments and the maintenance subscription.
import { PLANS } from "../../shared/catalog.js";
import { config } from "../config.js";
import { fromKillbill, killbillAmount } from "../rules/money.js";
import { ProviderRefused, expectOk, reach } from "./reach.js";

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_PAYMENT = "__EXTERNAL_PAYMENT__";

function kb(method: string, path: string, body?: unknown, query: Record<string, string> = {}, contentType = "application/json"): Promise<Response> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  const qs = new URLSearchParams(query).toString();
  return reach("killbill", `${config.killbill.url}/1.0/kb${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "spindrift-commission-stage",
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }, 30_000);
}

const idFromLocation = (response: Response): string => (response.headers.get("location") ?? "").replace(/\/+$/, "").split("/").pop() ?? "";

const catalogXml = (effectiveDate: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effectiveDate}</effectiveDate>
  <catalogName>spindrift-maintenance</catalogName>
  <currencies><currency>USD</currency></currencies>
  <products><product name="Maintenance"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${Object.values(PLANS).map((plan) => `
    <plan name="${plan.planName}">
      <product>Maintenance</product>
      <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${killbillAmount(plan.priceCents)}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`).join("")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans>${Object.values(PLANS).map((p) => `<plan>${p.planName}</plan>`).join("")}</plans></defaultPriceList>
  </priceLists>
</catalog>`;

/** Whether the tenant already has the maintenance catalog. */
export async function hasCatalog(): Promise<boolean> {
  const current = (await (await expectOk("killbill", await kb("GET", "/catalog"), 200)).json()) as { products?: { name: string }[] }[];
  return current.some((version) => version.products?.some((p) => p.name === "Maintenance"));
}

/**
 * Uploads the maintenance catalog. Each upload carries its own effective date (two days back, to the
 * millisecond) so a concurrent upload from another instance adds a version instead of colliding.
 */
export async function uploadCatalog(): Promise<void> {
  const effective = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await expectOk("killbill", await kb("POST", "/catalog/xml", catalogXml(effective), {}, "text/xml"), 201);
}

/** The payer's USD account (external key = app user id), created with the external payment method as default. */
export async function ensureAccount(user: { id: string; name: string; email: string }): Promise<string> {
  const found = await kb("GET", "/accounts", undefined, { externalKey: user.id });
  if (found.status === 200) return ((await found.json()) as { accountId: string }).accountId;
  await expectOk("killbill", found, 404);
  const created = await expectOk("killbill", await kb("POST", "/accounts", { name: user.name, email: user.email, externalKey: user.id, currency: "USD" }), 201);
  const accountId = idFromLocation(created);
  await expectOk("killbill", await kb("POST", `/accounts/${accountId}/paymentMethods`, { pluginName: EXTERNAL_PAYMENT, isDefault: true }, { isDefault: "true" }), 201);
  // Invoices are paid only by the app's PURCHASE carrying the request's Idempotency-Key.
  await expectOk("killbill", await kb("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]), 201);
  return accountId;
}

/** One invoice holding the work and sales-tax external charges. */
export async function invoiceCharges(accountId: string, title: string, label: string, subtotalCents: number, taxCents: number): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const items = [
    { accountId, description: `${title} — ${label} — work`, amount: killbillAmount(subtotalCents), currency: "USD", itemType: "EXTERNAL_CHARGE" },
    { accountId, description: `${title} — ${label} — sales tax`, amount: killbillAmount(taxCents), currency: "USD", itemType: "EXTERNAL_CHARGE" },
  ];
  const response = await expectOk("killbill", await kb("POST", `/invoices/charges/${accountId}`, items, { autoCommit: "true" }), 200, 201);
  const invoiceId = ((await response.json()) as { invoiceId: string }[])[0].invoiceId;
  return { invoiceId, invoiceNumber: (await getInvoice(invoiceId)).invoiceNumber };
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await expectOk("killbill", await kb("PUT", `/invoices/${invoiceId}/voidInvoice`), 204, 200);
}

export interface KillbillInvoice {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  balanceCents: number;
  items: { description: string; amountCents: number; startDate: string | null; endDate: string | null; subscriptionId: string | null }[];
}

interface RawInvoice {
  invoiceId: string;
  invoiceNumber: string | number;
  amount: number;
  balance: number;
  items: { description: string | null; amount: number; startDate: string | null; endDate: string | null; subscriptionId: string | null }[];
}

function toInvoice(raw: RawInvoice): KillbillInvoice {
  return {
    invoiceId: raw.invoiceId,
    invoiceNumber: String(raw.invoiceNumber),
    amountCents: fromKillbill(raw.amount),
    balanceCents: fromKillbill(raw.balance),
    items: (raw.items ?? []).map((i) => ({
      description: i.description ?? "",
      amountCents: fromKillbill(i.amount),
      startDate: i.startDate,
      endDate: i.endDate,
      subscriptionId: i.subscriptionId,
    })),
  };
}

export async function getInvoice(invoiceId: string): Promise<KillbillInvoice> {
  const response = await expectOk("killbill", await kb("GET", `/invoices/${invoiceId}`, undefined, { withItems: "true" }), 200);
  return toInvoice((await response.json()) as RawInvoice);
}

export async function accountInvoices(accountId: string): Promise<KillbillInvoice[]> {
  const response = await expectOk("killbill", await kb("GET", `/accounts/${accountId}/invoices`, undefined, { includeInvoiceComponents: "true" }), 200);
  return ((await response.json()) as RawInvoice[]).map(toInvoice);
}

interface RawPayment {
  paymentId: string;
  transactions: { transactionType: string; status: string; transactionExternalKey: string }[];
}

/** The payment made with this external key, if Kill Bill has one. */
export async function paymentByKey(paymentExternalKey: string): Promise<{ paymentId: string; succeeded: boolean } | null> {
  const response = await kb("GET", "/payments", undefined, { externalKey: paymentExternalKey });
  if (response.status === 404) return null;
  await expectOk("killbill", response, 200);
  const payment = (await response.json()) as RawPayment;
  return { paymentId: payment.paymentId, succeeded: payment.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS") };
}

/** One PURCHASE for the invoice's balance; the transaction external key is the request's Idempotency-Key. */
export async function purchase(accountId: string, invoiceId: string, amountCents: number, paymentExternalKey: string, transactionKey: string): Promise<{ paymentId: string; succeeded: boolean }> {
  const response = await kb(
    "POST",
    `/accounts/${accountId}/payments`,
    { transactionType: "PURCHASE", amount: killbillAmount(amountCents), currency: "USD", paymentExternalKey, transactionExternalKey: transactionKey },
    { controlPluginName: "__INVOICE_PAYMENT_CONTROL_PLUGIN__", pluginProperty: `IPCD_INVOICE_ID=${invoiceId}` },
  );
  if (response.status !== 201) {
    const known = await paymentByKey(paymentExternalKey);
    if (known) return known;
    throw new ProviderRefused("killbill", response.status, await response.text().catch(() => ""));
  }
  const found = await paymentByKey(paymentExternalKey);
  return found ?? { paymentId: idFromLocation(response), succeeded: false };
}

interface Subscription {
  subscriptionId: string;
  planName: string;
  chargedThroughDate: string | null;
  startDate: string;
}

export async function getSubscription(subscriptionId: string): Promise<Subscription> {
  const response = await expectOk("killbill", await kb("GET", `/subscriptions/${subscriptionId}`), 200);
  return (await response.json()) as Subscription;
}

export async function startSubscription(accountId: string, externalKey: string, planName: string, date: string): Promise<string> {
  const response = await expectOk("killbill", await kb(
    "POST",
    "/subscriptions",
    { accountId, externalKey, bundleExternalKey: externalKey, planName },
    { callCompletion: "true", callTimeoutSec: "10", entitlementDate: date, billingDate: date },
  ), 201);
  return idFromLocation(response);
}

/** Changes the plan from the given date; the catalog's change policy is IMMEDIATE. */
export async function changePlan(subscriptionId: string, planName: string, date: string): Promise<void> {
  await expectOk("killbill", await kb("PUT", `/subscriptions/${subscriptionId}`, { planName }, { callCompletion: "true", callTimeoutSec: "10", requestedDate: date }), 204, 200);
}

/** Waits for the invoice Kill Bill generates for a subscription after `afterNumber`. */
export async function awaitSubscriptionInvoice(accountId: string, subscriptionId: string, afterNumber: number): Promise<KillbillInvoice> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const fresh = (await accountInvoices(accountId))
      .filter((i) => Number(i.invoiceNumber) > afterNumber && i.items.some((item) => item.subscriptionId === subscriptionId))
      .sort((a, b) => Number(b.invoiceNumber) - Number(a.invoiceNumber));
    if (fresh.length) return fresh[0];
    if (Date.now() > deadline) throw new ProviderRefused("killbill", 504, "no subscription invoice generated");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function latestInvoiceNumber(accountId: string): Promise<number> {
  return Math.max(0, ...(await accountInvoices(accountId)).map((i) => Number(i.invoiceNumber)));
}

export async function accountPayments(accountId: string): Promise<{ paymentId: string; targetInvoiceIds: string[]; succeeded: boolean }[]> {
  const response = await expectOk("killbill", await kb("GET", `/accounts/${accountId}/payments`, undefined, { withAttempts: "false" }), 200);
  const rows = (await response.json()) as (RawPayment & { paymentAttempts?: unknown })[];
  const invoicePayments = await expectOk("killbill", await kb("GET", `/accounts/${accountId}/invoicePayments`), 200);
  const links = (await invoicePayments.json()) as { paymentId: string; targetInvoiceId: string }[];
  return rows.map((p) => ({
    paymentId: p.paymentId,
    targetInvoiceIds: links.filter((l) => l.paymentId === p.paymentId).map((l) => l.targetInvoiceId),
    succeeded: p.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS"),
  }));
}
