// Kill Bill: the system of record for money. Every call is real, carries the tenant's credentials
// and fails as "unreachable" when refused or unanswered in time (15 seconds; the health probe gives up after 5).
import { type Cadence, type TaxCode } from '../shared/catalog.js';
import { centsFromDecimal, decimalString } from '../shared/money.js';
import { TIME_ZONE } from '../shared/toronto.js';
import { config } from './config.js';

// A busy Kill Bill (invoice generation on its event bus) can take several seconds to answer a data call:
// a 5-second cap turned those stalls into false 503s. The health probe stays short so the banner shows in time.
const TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5000;
const SERVICE = 'loafline';
const SYSTEM_ACTOR = 'loafline';
const TAG_AUTO_PAY_OFF = '00000000-0000-0000-0000-000000000001';
const TAG_AUTO_INVOICING_DRAFT = '00000000-0000-0000-0000-000000000008';
const MONEY_KEYS = new Set(['amount', 'purchasedAmount', 'refundedAmount', 'balance', 'creditAdj', 'accountCBA', 'value']);

/** Kill Bill could not be reached, did not answer in time, or refused the call. */
export class BillingUnavailable extends Error {}

interface KbResponse {
  status: number;
  json: unknown;
  location: string | null;
}

/** Parses Kill Bill JSON keeping every money amount as its source digits, never as a float. */
function parseJson(text: string): unknown {
  if (!text) return null;
  const reviver = (key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && MONEY_KEYS.has(key) && context?.source ? context.source : value;
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

async function call(
  method: string,
  path: string,
  actor: string,
  options: { body?: unknown; xml?: string; query?: Record<string, string>; accept404?: boolean; timeoutMs?: number } = {},
): Promise<KbResponse> {
  const url = new URL(`${config.killbill.url}/1.0/kb${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.append(k, v);
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': actor,
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (options.xml !== undefined) {
    headers['Content-Type'] = 'text/xml';
    payload = options.xml;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) });
    text = await response.text();
  } catch (error) {
    console.error(`Kill Bill ${method} ${path}: ${(error as Error).message}`);
    throw new BillingUnavailable('Kill Bill unreachable');
  }
  if (response.status >= 400 && !(options.accept404 && response.status === 404)) {
    console.error(`Kill Bill ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    throw new BillingUnavailable(`Kill Bill answered ${response.status}`);
  }
  return { status: response.status, json: parseJson(text), location: response.headers.get('location') };
}

const idFromLocation = (location: string | null) => (location ?? '').split('?')[0]?.split('/').pop() ?? '';

/** Kill Bill is up when it answers a cheap tenant call (its own /healthcheck also grades internal queue lag). */
export async function healthy(): Promise<boolean> {
  try {
    await call('GET', '/catalog/versions', SYSTEM_ACTOR, { timeoutMs: HEALTH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

const randomTimeOfDay = () => new Date(Math.floor(Math.random() * 86_400_000)).toISOString().slice(11, 19);

const PLAN: Record<Cadence, string> = { MONTHLY: 'trio-monthly', BIMESTRIAL: 'trio-bimestrial', QUARTERLY: 'trio-quarterly' };

const planXml = (cadence: Cadence) => `
    <plan name="${PLAN[cadence]}"><product>trio</product><finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration><recurring><billingPeriod>${cadence}</billingPeriod><recurringPrice><price><currency>CAD</currency><value>29.04</value></price></recurringPrice></recurring></finalPhase></plan>`;

const catalogXml = (effectiveDate: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effectiveDate}</effectiveDate>
  <catalogName>loafline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CAD</currency></currencies>
  <units/>
  <products><product name="trio"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${planXml('MONTHLY')}${planXml('BIMESTRIAL')}${planXml('QUARTERLY')}
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans><plan>trio-monthly</plan><plan>trio-bimestrial</plan><plan>trio-quarterly</plan></plans></defaultPriceList></priceLists>
</catalog>`;

/**
 * Makes sure the tenant's catalog holds the three Trio plans; uploading is skipped when they exist.
 * Instances that start together may both upload, and Kill Bill cannot read a tenant's catalog once two versions
 * share an effective date, so each upload takes its own second of 2026-01-01 (the plans are identical either way).
 */
export async function ensureCatalog(): Promise<void> {
  const current = (await call('GET', '/catalog', SYSTEM_ACTOR)).json as { products?: { plans?: { name: string }[] }[] }[];
  const plans = new Set(current.flatMap((c) => (c.products ?? []).flatMap((p) => (p.plans ?? []).map((plan) => plan.name))));
  if (Object.values(PLAN).every((plan) => plans.has(plan))) return;
  await call('POST', '/catalog/xml', SYSTEM_ACTOR, { xml: catalogXml(`2026-01-01T${randomTimeOfDay()}+00:00`) });
}

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

/** The customer's one Kill Bill account (external key = email), created with the external payment method. */
export async function ensureAccount(email: string, name: string, locale: string): Promise<string> {
  const lookup = async () => {
    const found = await call('GET', '/accounts', SYSTEM_ACTOR, { query: { externalKey: email }, accept404: true });
    return found.status === 404 ? null : (found.json as KbAccount);
  };
  let account = await lookup();
  if (!account) {
    try {
      const created = await call('POST', '/accounts', SYSTEM_ACTOR, {
        body: { name, email, externalKey: email, currency: 'CAD', timeZone: TIME_ZONE, locale: locale.replace('-', '_') },
      });
      account = { accountId: idFromLocation(created.location), paymentMethodId: null };
      await call('POST', `/accounts/${account.accountId}/tags`, SYSTEM_ACTOR, { body: [TAG_AUTO_PAY_OFF, TAG_AUTO_INVOICING_DRAFT] });
    } catch (error) {
      // A concurrent first purchase for the same email created it: use that one, never a second account.
      account = await lookup();
      if (!account) throw error;
    }
  }
  if (!account.paymentMethodId) {
    await call('POST', `/accounts/${account.accountId}/paymentMethods`, SYSTEM_ACTOR, {
      query: { isDefault: 'true' },
      body: { pluginName: '__EXTERNAL_PAYMENT__' },
    });
  }
  return account.accountId;
}

interface InvoiceItem {
  invoiceItemId: string;
  itemType: string;
  description: string;
  amount: string;
  subscriptionId: string | null;
  linkedInvoiceItemId: string | null;
}

interface Invoice {
  invoiceId: string;
  invoiceDate: string;
  status: string;
  amount: string;
  balance: string;
  items: InvoiceItem[];
}

interface Charge {
  description: string;
  cents: number;
}

/** A draft invoice holding the external charges, then the tax items, committed; returns the committed invoice. */
export async function chargeInvoice(accountId: string, charges: Charge[], taxes: { code: TaxCode; cents: number }[]): Promise<Invoice> {
  const created = await call('POST', `/invoices/charges/${accountId}`, SYSTEM_ACTOR, {
    query: { autoCommit: 'false' },
    body: charges.map((c) => ({ accountId, amount: decimalString(c.cents), currency: 'CAD', description: c.description })),
  });
  const invoiceId = (created.json as { invoiceId: string }[])[0]?.invoiceId ?? '';
  return finishInvoice(accountId, invoiceId, taxes);
}

/** Adds one tax item per tax line to a draft invoice, commits it (Kill Bill applies any account credit) and reads it back. */
export async function finishInvoice(accountId: string, invoiceId: string, taxes: { code: TaxCode; cents: number }[]): Promise<Invoice> {
  if (taxes.length) {
    await call('POST', `/invoices/taxes/${accountId}`, SYSTEM_ACTOR, {
      query: { autoCommit: 'false' },
      body: taxes.map((t) => ({ invoiceId, accountId, amount: decimalString(t.cents), currency: 'CAD', description: t.code })),
    });
  }
  await call('PUT', `/invoices/${invoiceId}/commitInvoice`, SYSTEM_ACTOR);
  return invoice(invoiceId);
}

export async function invoice(invoiceId: string): Promise<Invoice> {
  return (await call('GET', `/invoices/${invoiceId}`, SYSTEM_ACTOR)).json as Invoice;
}

async function accountInvoices(accountId: string): Promise<Invoice[]> {
  return (await call('GET', `/accounts/${accountId}/invoices`, SYSTEM_ACTOR, { query: { includeInvoiceComponents: 'true' } }))
    .json as Invoice[];
}

/** One purchase paying an invoice, keyed by `key` for both payment and transaction. */
export async function payInvoice(accountId: string, invoiceId: string, cents: number, key: string): Promise<string> {
  await call('POST', `/accounts/${accountId}/payments`, SYSTEM_ACTOR, {
    query: { controlPluginName: '__INVOICE_PAYMENT_CONTROL_PLUGIN__', pluginProperty: `IPCD_INVOICE_ID=${invoiceId}` },
    body: { transactionType: 'PURCHASE', amount: decimalString(cents), currency: 'CAD', paymentExternalKey: key, transactionExternalKey: key },
  });
  const paid = (await call('GET', '/payments', SYSTEM_ACTOR, { query: { externalKey: key } })).json as Payment;
  if (!paid.transactions.some((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS')) {
    throw new BillingUnavailable(`payment ${key} did not succeed`);
  }
  return paid.paymentId;
}

interface PaymentTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: string;
  effectiveDate: string;
}

interface Payment {
  paymentId: string;
  accountId: string;
  paymentExternalKey: string;
  purchasedAmount: string;
  refundedAmount: string;
  transactions: PaymentTransaction[];
}

async function payment(paymentId: string): Promise<Payment> {
  return (await call('GET', `/payments/${paymentId}`, SYSTEM_ACTOR)).json as Payment;
}

/** Every payment of the tenant, page by page. */
export async function allPayments(): Promise<Payment[]> {
  const out: Payment[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = (await call('GET', '/payments/pagination', SYSTEM_ACTOR, { query: { offset: String(offset), limit: '500' } }))
      .json as Payment[];
    out.push(...page);
    if (page.length < 500) return out;
  }
}

/** Net paid on a payment: purchased minus refunded, in cents. */
export const netCents = (p: Payment) => centsFromDecimal(p.purchasedAmount) - centsFromDecimal(p.refundedAmount);

/** A refund on an invoice payment, adjusting each invoice item by its own amount; returns the refund transaction id. */
export async function refundInvoicePayment(
  paymentId: string,
  cents: number,
  adjustments: { invoiceItemId: string; cents: number }[],
  key: string,
  actor: string,
): Promise<string> {
  await call('POST', `/invoicePayments/${paymentId}/refunds`, actor, {
    body: {
      amount: decimalString(cents),
      currency: 'CAD',
      transactionExternalKey: key,
      isAdjusted: adjustments.length > 0,
      adjustments: adjustments.map((a) => ({ invoiceItemId: a.invoiceItemId, amount: decimalString(a.cents), currency: 'CAD' })),
    },
  });
  const refunded = await payment(paymentId);
  const transaction = refunded.transactions.filter((t) => t.transactionType === 'REFUND' && t.transactionExternalKey === key).pop();
  if (!transaction) throw new BillingUnavailable(`refund ${key} not found on payment ${paymentId}`);
  return transaction.transactionId;
}

/** An account credit for `cents`, described "Goodwill <cr>"; returns the credit item id. */
export async function addCredit(accountId: string, cents: number, number: string, actor: string): Promise<string> {
  const created = await call('POST', '/credits', actor, {
    query: { autoCommit: 'true' },
    body: [{ accountId, amount: decimalString(cents), currency: 'CAD', description: `Goodwill ${number}` }],
  });
  return (created.json as { invoiceItemId: string }[])[0]?.invoiceItemId ?? '';
}

export async function createSubscription(accountId: string, cadence: Cadence, externalKey: string): Promise<string> {
  const created = await call('POST', '/subscriptions', SYSTEM_ACTOR, {
    body: { accountId, planName: PLAN[cadence], externalKey, bundleExternalKey: externalKey },
  });
  return idFromLocation(created.location);
}

/** The draft invoice Kill Bill generated for a subscription, waiting for its (asynchronous) invoice generation. */
export async function draftInvoiceFor(accountId: string, subscriptionId: string): Promise<Invoice | undefined> {
  // Invoice generation runs off Kill Bill's event bus and lags by seconds when it is busy: allow up to 20 seconds.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const draft = (await accountInvoices(accountId)).find(
      (inv) => inv.status === 'DRAFT' && inv.items.some((item) => item.subscriptionId === subscriptionId),
    );
    if (draft) return draft;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(`Kill Bill: no draft invoice for subscription ${subscriptionId} after 20 seconds`);
  return undefined;
}

type BlockingState = 'TRIO_SKIP' | 'TRIO_PAUSE' | 'TRIO_CLEAR';

/** A subscription-level blocking state of service `loafline`, effective at `at`. */
export async function block(subscriptionId: string, state: BlockingState, at: Date): Promise<void> {
  await call('POST', `/subscriptions/${subscriptionId}/block`, SYSTEM_ACTOR, {
    query: { requestedDate: at.toISOString() },
    body: {
      stateName: state,
      service: SERVICE,
      isBlockChange: false,
      isBlockEntitlement: false,
      isBlockBilling: state !== 'TRIO_CLEAR',
      type: 'SUBSCRIPTION',
    },
  });
}

/** A dated plan change; a pending change is undone first, so at most one is ever pending. */
export async function changePlan(subscriptionId: string, cadence: Cadence, date: string, replacesPending: boolean): Promise<void> {
  if (replacesPending) await call('PUT', `/subscriptions/${subscriptionId}/undoChangePlan`, SYSTEM_ACTOR);
  await call('PUT', `/subscriptions/${subscriptionId}`, SYSTEM_ACTOR, {
    query: { requestedDate: date },
    body: { planName: PLAN[cadence] },
  });
}

export async function cancel(subscriptionId: string, date: string): Promise<void> {
  await call('DELETE', `/subscriptions/${subscriptionId}`, SYSTEM_ACTOR, {
    query: { requestedDate: date, useRequestedDateForBilling: 'true' },
  });
}

/** The amount Kill Bill recorded for a credit item, in cents. */
export async function creditCents(itemId: string): Promise<number | null> {
  const found = await call('GET', `/credits/${itemId}`, SYSTEM_ACTOR, { accept404: true });
  return found.status === 404 ? null : centsFromDecimal((found.json as { amount: string }).amount);
}
