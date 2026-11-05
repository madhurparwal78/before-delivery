import { config } from '../config.js';
import type { PlanName } from '../domain/plans.js';
import { PLANS, planByKillbillPlanName } from '../domain/plans.js';
import { centsToEuroString } from '../domain/money.js';
import { catalogueXml } from './killbill-catalogue.js';

/** Thrown when Kill Bill is unreachable or refuses the request. */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

const CREATED_BY = 'turnstone-studio';

function baseHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': CREATED_BY,
    accept: 'application/json',
  };
}

interface CallResult {
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}

async function call(
  method: string,
  path: string,
  options: {
    readonly json?: unknown;
    readonly xml?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<CallResult> {
  const headers = baseHeaders();
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.xml !== undefined) {
    headers['content-type'] = 'text/xml';
    body = options.xml;
  }

  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    });
  } catch (error) {
    throw new BillingError(`Billing request failed: ${String(error)}`);
  }
  const text = await response.text();
  if (response.status >= 500) {
    throw new BillingError(`Billing answered ${response.status} for ${method} ${path}`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

function parseJson<T>(result: CallResult): T {
  if (result.text === '') throw new BillingError('Billing returned an empty body');
  return JSON.parse(result.text) as T;
}

function idFromLocation(result: CallResult): string {
  const location = result.location;
  if (location === null) throw new BillingError('Billing returned no resource location');
  const id = location.split('/').pop();
  if (id === undefined || id === '') throw new BillingError('Billing returned no resource id');
  return id;
}

function expectOk(result: CallResult, method: string, path: string): CallResult {
  if (result.status >= 400) {
    throw new BillingError(`Billing answered ${result.status} for ${method} ${path}`);
  }
  return result;
}

export async function billingUp(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(4_000),
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

interface CatalogueVersionJson {
  readonly products: readonly { readonly plans: readonly { readonly name: string }[] }[];
}

/** Uploads the catalogue to the tenant if the tenant has none. */
export async function ensureCatalogue(): Promise<void> {
  const current = await call('GET', '/1.0/kb/catalog');
  if (current.status < 400 && current.text !== '') {
    const versions = parseJson<readonly CatalogueVersionJson[]>(current);
    const hasPlans = versions.some((v) => v.products.some((p) => p.plans.length > 0));
    if (hasPlans) return;
  }
  expectOk(
    await call('POST', '/1.0/kb/catalog/xml', { xml: catalogueXml() }),
    'POST',
    '/1.0/kb/catalog/xml',
  );
}

interface AccountJson {
  readonly accountId: string;
  readonly externalKey: string;
}

export function authorAccountKey(): string {
  return `turnstone-${config.instance}-author`;
}

export function buyerAccountKey(email: string): string {
  return `turnstone-${config.instance}-buyer-${email.toLowerCase()}`;
}

export function bundleKey(): string {
  return `turnstone-${config.instance}-studio-plan`;
}

async function findAccount(externalKey: string): Promise<AccountJson | null> {
  const result = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
  );
  if (result.status === 404) return null;
  if (result.status >= 400) {
    throw new BillingError(`Billing answered ${result.status} looking up an account`);
  }
  return parseJson<AccountJson>(result);
}

interface PaymentMethodJson {
  readonly paymentMethodId: string;
  readonly isDefault: boolean;
  readonly pluginName: string;
}

const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

async function ensureExternalPaymentMethod(accountId: string): Promise<void> {
  const existing = parseJson<readonly PaymentMethodJson[]>(
    expectOk(
      await call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`),
      'GET',
      'paymentMethods',
    ),
  );
  if (existing.some((m) => m.pluginName === EXTERNAL_PAYMENT_PLUGIN && m.isDefault)) return;
  expectOk(
    await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      json: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
    }),
    'POST',
    'paymentMethods',
  );
}

/** Creates the account on first use, with the external payment method as default. */
export async function ensureAccount(externalKey: string): Promise<string> {
  const existing = await findAccount(externalKey);
  if (existing !== null) {
    await ensureExternalPaymentMethod(existing.accountId);
    return existing.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    json: { externalKey, currency: 'EUR', name: externalKey, locale: 'en_US' },
  });
  if (created.status >= 400) {
    // Another instance may have created it between the lookup and the write.
    const raced = await findAccount(externalKey);
    if (raced === null) {
      throw new BillingError(`Billing answered ${created.status} creating an account`);
    }
    await ensureExternalPaymentMethod(raced.accountId);
    return raced.accountId;
  }
  const accountId = idFromLocation(created);
  await ensureExternalPaymentMethod(accountId);
  return accountId;
}

interface SubscriptionJson {
  readonly subscriptionId: string;
  readonly planName: string;
  readonly billingStartDate: string;
  readonly state: string;
  readonly events?: readonly {
    readonly eventType: string;
    readonly effectiveDate: string;
    readonly plan: string | null;
    readonly isBlockedBilling?: boolean;
  }[];
}

interface BundleJson {
  readonly externalKey: string;
  readonly subscriptions: readonly SubscriptionJson[];
}

async function authorBundle(accountId: string): Promise<BundleJson | null> {
  const bundles = parseJson<readonly BundleJson[]>(
    expectOk(await call('GET', `/1.0/kb/accounts/${accountId}/bundles`), 'GET', 'bundles'),
  );
  return bundles.find((b) => b.externalKey === bundleKey()) ?? null;
}

/** The author holds one subscription, created on Pro at first start. */
export async function ensureAuthorSubscription(accountId: string): Promise<string> {
  const bundle = await authorBundle(accountId);
  const existing = bundle?.subscriptions[0];
  if (existing !== undefined) return existing.subscriptionId;
  const created = await call('POST', '/1.0/kb/subscriptions?callCompletion=true', {
    json: {
      accountId,
      bundleExternalKey: bundleKey(),
      planName: PLANS.pro.killbillPlan,
    },
  });
  if (created.status >= 400) {
    const raced = await authorBundle(accountId);
    const subscription = raced?.subscriptions[0];
    if (subscription === undefined) {
      throw new BillingError(`Billing answered ${created.status} creating the subscription`);
    }
    return subscription.subscriptionId;
  }
  return idFromLocation(created);
}

export interface PlanReport {
  readonly subscriptionId: string;
  readonly plan: PlanName;
  readonly pendingPlan: PlanName | null;
  readonly pendingEffectiveDate: string | null;
  readonly billingCycleDay: number;
}

/** What Kill Bill reports as the author's active plan today, and any pending change. */
export async function readPlan(subscriptionId: string): Promise<PlanReport> {
  const subscription = parseJson<SubscriptionJson>(
    expectOk(await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`), 'GET', 'subscription'),
  );
  const active = planByKillbillPlanName(subscription.planName);
  if (active === null) {
    throw new BillingError(`Billing reports an unknown plan ${subscription.planName}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  let pendingPlan: PlanName | null = null;
  let pendingEffectiveDate: string | null = null;
  for (const event of subscription.events ?? []) {
    if (event.eventType !== 'CHANGE' || event.plan === null) continue;
    const effective = event.effectiveDate.slice(0, 10);
    if (effective <= today) continue;
    const target = planByKillbillPlanName(event.plan);
    if (target === null) continue;
    pendingPlan = target;
    pendingEffectiveDate = effective;
  }

  const startDay = Number.parseInt(subscription.billingStartDate.slice(8, 10), 10);
  return {
    subscriptionId,
    plan: active,
    pendingPlan,
    pendingEffectiveDate,
    billingCycleDay: Number.isFinite(startDay) && startDay >= 1 ? startDay : 1,
  };
}

interface InvoiceJson {
  readonly invoiceId: string;
  readonly amount: number;
  readonly balance: number;
  readonly invoiceDate: string;
}

async function accountInvoiceIds(accountId: string): Promise<ReadonlySet<string>> {
  const invoices = parseJson<readonly InvoiceJson[]>(
    expectOk(await call('GET', `/1.0/kb/accounts/${accountId}/invoices`), 'GET', 'invoices'),
  );
  return new Set(invoices.map((i) => i.invoiceId));
}

async function invoicesAddedSince(
  accountId: string,
  before: ReadonlySet<string>,
): Promise<readonly InvoiceJson[]> {
  const invoices = parseJson<readonly InvoiceJson[]>(
    expectOk(await call('GET', `/1.0/kb/accounts/${accountId}/invoices`), 'GET', 'invoices'),
  );
  return invoices.filter((i) => !before.has(i.invoiceId));
}

export interface PlanChangeResult {
  readonly chargedCents: number;
  readonly effectiveDate: string | null;
}

/**
 * An upgrade is sent with immediate effect; Kill Bill prorates and invoices it.
 * A downgrade is sent to take effect at the end of the billing period.
 */
export async function changePlan(
  accountId: string,
  subscriptionId: string,
  target: PlanName,
  immediate: boolean,
): Promise<PlanChangeResult> {
  const before = immediate ? await accountInvoiceIds(accountId) : new Set<string>();
  const billingPolicy = immediate ? 'IMMEDIATE' : 'END_OF_TERM';
  expectOk(
    await call(
      'PUT',
      `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=${billingPolicy}&callCompletion=true`,
      { json: { subscriptionId, planName: PLANS[target].killbillPlan } },
    ),
    'PUT',
    'subscription',
  );

  if (!immediate) {
    const report = await readPlan(subscriptionId);
    return { chargedCents: 0, effectiveDate: report.pendingEffectiveDate };
  }

  const added = await invoicesAddedSince(accountId, before);
  const euros = added.reduce((sum, invoice) => sum + invoice.amount, 0);
  const cents = Math.max(0, Math.round(euros * 100));
  for (const invoice of added) {
    if (invoice.balance > 0) await payInvoice(accountId, invoice.invoiceId, Math.round(invoice.balance * 100));
  }
  return { chargedCents: cents, effectiveDate: null };
}

interface InvoiceItemJson {
  readonly invoiceId: string;
}

/** One external charge on the buyer's account, on a committed invoice. */
export async function createExternalCharge(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<string> {
  const result = expectOk(
    await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
      json: [
        {
          accountId,
          amount: Number(centsToEuroString(amountCents)),
          currency: 'EUR',
          description,
        },
      ],
    }),
    'POST',
    'charges',
  );
  const items = parseJson<readonly InvoiceItemJson[]>(result);
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new BillingError('Billing returned no invoice for the charge');
  return invoiceId;
}

interface PaymentJson {
  readonly paymentId: string;
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly transactionType: string;
    readonly status: string;
  }[];
}

/** One payment for the same amount, with a successful PURCHASE transaction. */
export async function payInvoice(
  accountId: string,
  invoiceId: string,
  amountCents: number,
): Promise<string> {
  const result = expectOk(
    await call('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
      json: {
        accountId,
        targetInvoiceId: invoiceId,
        purchasedAmount: Number(centsToEuroString(amountCents)),
        currency: 'EUR',
      },
    }),
    'POST',
    'payments',
  );
  if (result.text !== '') {
    const payment = parseJson<PaymentJson>(result);
    const purchase = payment.transactions.find((t) => t.transactionType === 'PURCHASE');
    if (purchase === undefined || purchase.status !== 'SUCCESS') {
      throw new BillingError('Billing did not confirm a successful PURCHASE');
    }
    return payment.paymentId;
  }
  const payments = parseJson<readonly PaymentJson[]>(
    expectOk(
      await call('GET', `/1.0/kb/invoices/${invoiceId}/payments`),
      'GET',
      'invoice payments',
    ),
  );
  const payment = payments.find((p) =>
    p.transactions.some((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS'),
  );
  if (payment === undefined) throw new BillingError('Billing did not confirm a successful PURCHASE');
  return payment.paymentId;
}

/** Each refund is a REFUND transaction on that payment. */
export async function refundPayment(paymentId: string, amountCents: number): Promise<void> {
  expectOk(
    await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      json: {
        paymentId,
        amount: Number(centsToEuroString(amountCents)),
        currency: 'EUR',
      },
    }),
    'POST',
    'refunds',
  );
}
