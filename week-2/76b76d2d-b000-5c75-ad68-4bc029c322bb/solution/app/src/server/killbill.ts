import { config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { query, transaction } from "./db.ts";
import { catalogXml } from "./catalog.ts";
import { centsToDecimal, decimalToCents } from "./money.ts";

/** Kill Bill counts as unreachable when a call fails to connect or takes longer than 10 seconds. */
const CALL_TIMEOUT_MS = 10_000;
const PROBE_EVERY_MS = 5_000;
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";

let billingUp = true;
export const isBillingUp = (): boolean => billingUp;

/** Raised for any failed Kill Bill call; the request answers `billing_unavailable`. */
export class BillingFailure extends Error {}

type KbResponse = { status: number; location: string | null; data: unknown };

const AMOUNT_MARK = "§amount§";
const amount = (cents: number): string => `${AMOUNT_MARK}${centsToDecimal(cents)}`;

function encode(body: unknown): string {
  return JSON.stringify(body).replace(/"§amount§(-?\d+\.\d{2})"/g, "$1");
}

type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;
const keepNumberText: Reviver = (_key, value, context) => (typeof value === "number" && context?.source ? context.source : value);

function decode(text: string): unknown {
  return text ? JSON.parse(text, keepNumberText as (key: string, value: unknown) => unknown) : null;
}

async function call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<KbResponse> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "X-Killbill-ApiKey": apiKey,
    "X-Killbill-ApiSecret": apiSecret,
    "X-Killbill-CreatedBy": "halide-box-office",
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = contentType;
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : encode(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    billingUp = false;
    throw new BillingFailure(`${method} ${path} unreachable`);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = decode(text);
  } catch {
    throw new BillingFailure(`${method} ${path} answered ${response.status} without JSON`);
  }
  return { status: response.status, location: response.headers.get("location"), data };
}

async function ok(method: string, path: string, body?: unknown, contentType?: string): Promise<KbResponse> {
  const response = await call(method, path, body, contentType);
  if (response.status >= 300) throw new BillingFailure(`${method} ${path} answered ${response.status}`);
  return response;
}

const idFrom = (location: string | null): string => {
  const id = location?.replace(/\/+$/, "").split("/").pop();
  if (!id) throw new BillingFailure("no Location header");
  return id;
};

/** Refuses a money-moving request up front while Kill Bill is known to be down. */
export function requireBilling(): void {
  if (!billingUp) throw new ApiError("billing_unavailable");
}

/**
 * A cheap tenant read. Kill Bill's own health endpoint recomputes unsynchronised queue statistics on
 * every request, so concurrent pollers can leave it failing for good; the probe never calls it.
 */
async function probe(): Promise<void> {
  try {
    await call("GET", "/catalog/versions");
    billingUp = true;
  } catch {
    billingUp = false;
  }
}

/** Probes every 5 seconds and, while billing is up, finishes any pending undo. */
export function startBillingProbe(): void {
  const tick = async (): Promise<void> => {
    await probe();
    if (billingUp) await runCompensations().catch(() => undefined);
    setTimeout(tick, PROBE_EVERY_MS);
  };
  void tick();
}

/**
 * Uploads the CAD catalogue once if it is missing, retrying every 5 seconds until it succeeds.
 * Instances sharing the database take an advisory lock first, so only one of them uploads.
 */
export function ensureCatalogue(): void {
  const attempt = async (): Promise<void> => {
    try {
      await transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(724101)");
        const current = await ok("GET", "/catalog");
        if (Array.isArray(current.data) && current.data.length > 0) return;
        await ok("POST", "/catalog/xml", catalogXml(), "text/xml");
      });
    } catch {
      setTimeout(() => void attempt(), PROBE_EVERY_MS);
    }
  };
  void attempt();
}

type KbAccountInput = { externalKey: string; name: string; email: string; locale: "en" | "fr" };

/** Finds or creates the patron's or guest's CAD account, paid through `__EXTERNAL_PAYMENT__`. */
export async function ensureAccount(input: KbAccountInput): Promise<string> {
  const created = await call("POST", "/accounts", {
    externalKey: input.externalKey, name: input.name, email: input.email, currency: "CAD",
    locale: input.locale === "fr" ? "fr_CA" : "en_CA", timeZone: "America/Toronto",
  });
  let accountId: string;
  if (created.status === 201) accountId = idFrom(created.location);
  else {
    const found = await ok("GET", `/accounts?externalKey=${encodeURIComponent(input.externalKey)}`);
    accountId = String((found.data as { accountId: string }).accountId);
  }
  const account = (await ok("GET", `/accounts/${accountId}`)).data as { paymentMethodId?: string | null };
  if (!account.paymentMethodId) {
    await ok("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__", isDefault: true });
  }
  const tags = (await ok("GET", `/accounts/${accountId}/tags`)).data as { tagDefinitionId: string }[];
  if (!tags.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF)) await ok("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]);
  return accountId;
}

type KbItem = { itemType: string; description: string | null; amount: string; subscriptionId: string | null };
type KbInvoice = { invoiceId: string; invoiceNumber: string; amount: string; balance: string; items: KbItem[] | null };

/** The invoice as the app reports it: credit-applied items are separated from the billed items. */
export type BilledInvoice = {
  invoiceId: string; amountCents: number; creditAppliedCents: number; paidCents: number; paymentId: string | null;
  items: { type: string; description: string; amount_cents: number }[];
};

async function invoice(invoiceId: string): Promise<KbInvoice> {
  return (await ok("GET", `/invoices/${invoiceId}?withItems=true`)).data as KbInvoice;
}

function describe(inv: KbInvoice, paidCents: number, paymentId: string | null): BilledInvoice {
  const items = inv.items ?? [];
  const credit = items.filter((item) => item.itemType === "CBA_ADJ").reduce((sum, item) => sum + decimalToCents(item.amount), 0);
  return {
    invoiceId: inv.invoiceId,
    amountCents: decimalToCents(inv.amount),
    creditAppliedCents: -credit,
    paidCents,
    paymentId,
    items: items.filter((item) => item.itemType !== "CBA_ADJ").map((item) => ({
      type: item.itemType, description: item.description ?? "", amount_cents: decimalToCents(item.amount),
    })),
  };
}

/**
 * Pays an invoice's remaining balance with one PURCHASE under `paymentKey`; no payment when nothing
 * is due. The PURCHASE is the last Kill Bill call, so nothing after it can fail and strand the payment.
 */
async function payBalance(accountId: string, inv: KbInvoice, paymentKey: string): Promise<BilledInvoice> {
  const due = decimalToCents(inv.balance);
  if (due <= 0) return describe(inv, 0, null);
  const paid = await ok("POST", `/invoices/${inv.invoiceId}/payments?externalPayment=false`, {
    accountId, purchasedAmount: amount(due), paymentExternalKey: paymentKey,
  });
  return describe(inv, due, idFrom(paid.location));
}

type Compensation = { kind: "void-invoice" | "refund-payment"; kbId: string; cents: number };

async function compensate(item: Compensation): Promise<boolean> {
  const response = item.kind === "void-invoice"
    ? await call("PUT", `/invoices/${item.kbId}/voidInvoice`).catch(() => null)
    : await call("POST", `/payments/${item.kbId}/refunds`, { amount: amount(item.cents), transactionExternalKey: `${item.kbId}-undo` }).catch(() => null);
  return response !== null && response.status < 300;
}

/** Leaves no charge standing: undoes it now, or as soon as billing allows. */
async function undo(item: Compensation): Promise<void> {
  if (await compensate(item)) return;
  await query("INSERT INTO billing_compensations (kind, kb_id, cents) VALUES ($1, $2, $3)", [item.kind, item.kbId, item.cents]);
}

/** Undoes a charge whose local commit failed: refunds its payment, or voids an unpaid invoice. */
export async function undoCharge(billed: BilledInvoice): Promise<void> {
  await undo(billed.paymentId
    ? { kind: "refund-payment", kbId: billed.paymentId, cents: billed.paidCents }
    : { kind: "void-invoice", kbId: billed.invoiceId, cents: 0 });
}

export type Charge = { type: "EXTERNAL_CHARGE" | "TAX"; description: string; cents: number };

/**
 * One invoice of external charges and taxes: created as a draft, committed (Kill Bill applies
 * account credit), then the remainder paid by one PURCHASE. Any failure voids the invoice.
 */
export async function chargeInvoice(accountId: string, charges: Charge[], paymentKey: string): Promise<BilledInvoice> {
  const item = (charge: Charge, invoiceId?: string): Record<string, unknown> => ({
    accountId, ...(invoiceId ? { invoiceId } : {}), amount: amount(charge.cents), currency: "CAD", description: charge.description,
  });
  const external = charges.filter((charge) => charge.type === "EXTERNAL_CHARGE");
  const draft = await ok("POST", `/invoices/charges/${accountId}?autoCommit=false`, external.map((charge) => item(charge)));
  const invoiceId = String((draft.data as { invoiceId: string }[])[0]?.invoiceId);
  try {
    const taxes = charges.filter((charge) => charge.type === "TAX");
    if (taxes.length) await ok("POST", `/invoices/taxes/${accountId}?autoCommit=false`, taxes.map((charge) => item(charge, invoiceId)));
    await ok("PUT", `/invoices/${invoiceId}/commitInvoice`);
    return await payBalance(accountId, await invoice(invoiceId), paymentKey);
  } catch (error) {
    await undo({ kind: "void-invoice", kbId: invoiceId, cents: 0 });
    throw error;
  }
}

export async function addCredit(accountId: string, cents: number, description: string): Promise<void> {
  await ok("POST", "/credits?autoCommit=true", [{ accountId, amount: amount(cents), currency: "CAD", description }]);
}

/** A REFUND on the booking's payment; a retry with the same key finds the earlier refund. */
export async function refundPayment(paymentId: string, cents: number, key: string): Promise<void> {
  const response = await call("POST", `/payments/${paymentId}/refunds`, { amount: amount(cents), transactionExternalKey: key });
  if (response.status < 300) return;
  const payment = (await ok("GET", `/payments/${paymentId}`)).data as { transactions: { transactionExternalKey: string; status: string }[] };
  if (!payment.transactions.some((tx) => tx.transactionExternalKey === key && tx.status === "SUCCESS")) {
    throw new BillingFailure(`refund answered ${response.status}`);
  }
}

async function invoices(accountId: string): Promise<KbInvoice[]> {
  return (await ok("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`)).data as KbInvoice[];
}

/** Waits for the invoice Kill Bill generates for a subscription event, newer than `after`. */
async function awaitSubscriptionInvoice(accountId: string, subscriptionId: string, after: number): Promise<KbInvoice> {
  const deadline = Date.now() + CALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = (await invoices(accountId)).find((inv) => Number(inv.invoiceNumber) > after && (inv.items ?? []).some((item) => item.subscriptionId === subscriptionId));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new BillingFailure("no subscription invoice");
}

async function latestInvoiceNumber(accountId: string): Promise<number> {
  return Math.max(0, ...(await invoices(accountId)).map((inv) => Number(inv.invoiceNumber)));
}

export type KbSubscription = { subscriptionId: string; planName: string; chargedThroughDate: string | null; billingStartDate: string };

async function subscription(subscriptionId: string): Promise<KbSubscription> {
  return (await ok("GET", `/subscriptions/${subscriptionId}`)).data as KbSubscription;
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await call("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE`).catch(() => null);
}

/** Starts one subscription and pays its first invoice; on failure it is cancelled again. */
export async function subscribe(accountId: string, plan: string, bundleKey: string, paymentKey: string): Promise<{ subscription: KbSubscription; invoice: BilledInvoice }> {
  const before = await latestInvoiceNumber(accountId);
  const created = await ok("POST", "/subscriptions", { accountId, planName: plan, bundleExternalKey: bundleKey });
  const subscriptionId = idFrom(created.location);
  try {
    const first = await awaitSubscriptionInvoice(accountId, subscriptionId, before);
    const billed = await payBalance(accountId, first, paymentKey);
    return { subscription: await subscription(subscriptionId), invoice: billed };
  } catch (error) {
    await cancelSubscription(subscriptionId);
    throw error;
  }
}

/** Changes the plan: IMMEDIATE returns Kill Bill's prorated invoice, END_OF_TERM returns none. */
export async function changePlan(accountId: string, subscriptionId: string, plan: string, policy: "IMMEDIATE" | "END_OF_TERM", paymentKey: string): Promise<{ subscription: KbSubscription; invoice: BilledInvoice | null }> {
  const before = await latestInvoiceNumber(accountId);
  await ok("PUT", `/subscriptions/${subscriptionId}?billingPolicy=${policy}`, { planName: plan });
  if (policy === "END_OF_TERM") return { subscription: await subscription(subscriptionId), invoice: null };
  const prorated = await awaitSubscriptionInvoice(accountId, subscriptionId, before);
  const billed = await payBalance(accountId, prorated, paymentKey);
  return { subscription: await subscription(subscriptionId), invoice: billed };
}

type KbPayment = { accountId: string; transactions: { transactionType: string; status: string; amount: string; effectiveDate: string }[] };

/** Every payment in the tenant, page by page. */
export async function allPayments(): Promise<KbPayment[]> {
  const out: KbPayment[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = (await ok("GET", `/payments/pagination?offset=${offset}&limit=200`)).data as KbPayment[];
    out.push(...page);
    if (page.length < 200) return out;
  }
}

/** Finishes the undos that could not run when they were needed. */
async function runCompensations(): Promise<void> {
  const pending = await query<{ id: number; kind: Compensation["kind"]; kb_id: string; cents: number }>(
    "SELECT id, kind, kb_id, cents FROM billing_compensations WHERE NOT done ORDER BY id",
  );
  for (const item of pending) {
    if (await compensate({ kind: item.kind, kbId: item.kb_id, cents: item.cents })) {
      await query("UPDATE billing_compensations SET done = true WHERE id = $1", [item.id]);
    }
  }
}
