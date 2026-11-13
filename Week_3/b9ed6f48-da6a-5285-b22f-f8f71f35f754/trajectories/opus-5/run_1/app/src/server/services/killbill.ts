import { config } from '../config.js';
import { AppError } from '../errors.js';
import { CURRENCIES, majorToMinor, minorToMajor, type Currency } from '../../shared/money.js';
import type { TierKey } from '../../shared/copy.js';

export const TIER_PLANS: Record<TierKey, string> = {
  reader: 'supporter-reader-monthly',
  fellow: 'supporter-fellow-monthly',
  patron: 'supporter-patron-monthly',
};

export const TICKET_PLAN = 'guided-session-ticket';

export const TIER_PRODUCTS: Record<TierKey, string> = {
  reader: 'SupporterReader',
  fellow: 'SupporterFellow',
  patron: 'SupporterPatron',
};

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const BASE_CATALOG_EFFECTIVE_DATE = '2020-01-01T00:00:00+00:00';
const REQUEST_TIMEOUT_MS = 30_000;

function headers(contentType: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'sightline',
    'Content-Type': contentType,
    Accept: 'application/json',
  };
}

interface RawResponse {
  status: number;
  location: string | null;
  text: string;
}

async function request(
  method: string,
  path: string,
  options: { json?: unknown; xml?: string } = {},
): Promise<RawResponse> {
  const body = options.xml ?? (options.json === undefined ? undefined : JSON.stringify(options.json));
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(options.xml === undefined ? 'application/json' : 'text/xml'),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('billing_unavailable');
  }
  const text = await response.text();
  if (response.status >= 500) throw new AppError('billing_unavailable');
  if (response.status >= 400) {
    throw new Error(`Kill Bill ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

async function requestJson<T>(method: string, path: string, json?: unknown): Promise<T> {
  const raw = await request(method, path, { json });
  return (raw.text ? JSON.parse(raw.text) : null) as T;
}

function idFromLocation(location: string | null): string {
  if (!location) throw new Error('Kill Bill did not return a Location header');
  const parts = location.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] as string;
}

/* --------------------------------------------------------------- catalog */

interface RawCatalogPrice {
  currency: string;
  value: number;
}

interface RawCatalogPhase {
  prices: RawCatalogPrice[];
  fixedPrices: RawCatalogPrice[];
}

interface RawCatalogPlan {
  name: string;
  phases: RawCatalogPhase[];
}

interface RawCatalogProduct {
  name: string;
  plans: RawCatalogPlan[];
}

interface RawCatalogVersion {
  effectiveDate: string;
  products: RawCatalogProduct[];
}

export interface CatalogVersion {
  effectiveDateMs: number;
  /** Plan name to currency to minor units. */
  prices: Record<string, Partial<Record<Currency, number>>>;
}

function parseCatalog(versions: RawCatalogVersion[]): CatalogVersion[] {
  return versions
    .map((version) => {
      const prices: Record<string, Partial<Record<Currency, number>>> = {};
      for (const product of version.products) {
        for (const plan of product.plans) {
          const planPrices: Partial<Record<Currency, number>> = {};
          for (const phase of plan.phases) {
            for (const price of [...phase.prices, ...phase.fixedPrices]) {
              if ((CURRENCIES as readonly string[]).includes(price.currency)) {
                planPrices[price.currency as Currency] = majorToMinor(price.value, price.currency as Currency);
              }
            }
          }
          prices[plan.name] = planPrices;
        }
      }
      return { effectiveDateMs: Date.parse(version.effectiveDate), prices };
    })
    .sort((a, b) => a.effectiveDateMs - b.effectiveDateMs);
}

export async function readCatalogVersions(): Promise<CatalogVersion[]> {
  const raw = await requestJson<RawCatalogVersion[]>('GET', '/1.0/kb/catalog');
  return parseCatalog(raw);
}

export async function uploadCatalog(xml: string): Promise<void> {
  await request('POST', '/1.0/kb/catalog/xml', { xml });
}

export const BASE_CATALOG_DATE_MS = Date.parse(BASE_CATALOG_EFFECTIVE_DATE);

/* -------------------------------------------------------------- accounts */

export async function createAccount(input: {
  externalKey: string;
  name: string;
  email: string;
  currency: Currency;
}): Promise<string> {
  const raw = await request('POST', '/1.0/kb/accounts', {
    json: { externalKey: input.externalKey, name: input.name, email: input.email, currency: input.currency },
  });
  const accountId = idFromLocation(raw.location);
  await request('POST', `/1.0/kb/accounts/${accountId}/tags`, { json: [AUTO_PAY_OFF_TAG] });
  return accountId;
}

/* --------------------------------------------------------- subscriptions */

export interface SubscriptionEvent {
  eventType: string;
  effectiveDate: string;
  plan: string | null;
}

export interface SubscriptionState {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  cancelledDate: string | null;
  events: SubscriptionEvent[];
}

export async function createSubscription(accountId: string, planName: string): Promise<string> {
  const raw = await request('POST', '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=25', {
    json: { accountId, planName },
  });
  return idFromLocation(raw.location);
}

export async function readSubscription(subscriptionId: string): Promise<SubscriptionState> {
  return requestJson<SubscriptionState>('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
}

export type ChangePolicy = 'IMMEDIATE' | 'END_OF_TERM';

export async function changePlan(subscriptionId: string, planName: string, policy: ChangePolicy): Promise<void> {
  await request(
    'PUT',
    `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=${policy}&callCompletion=true&callTimeoutSec=25`,
    { json: { subscriptionId, planName } },
  );
}

export async function undoChangePlan(subscriptionId: string): Promise<void> {
  await request('PUT', `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`);
}

/**
 * An immediate cancellation stops the entitlement at once and leaves billing to lapse at the
 * end of the paid term, so Kill Bill raises no repair credit that would then silently settle a
 * later subscription's first invoice.
 */
export async function cancelSubscription(subscriptionId: string, policy: ChangePolicy): Promise<void> {
  const entitlementPolicy = policy === 'IMMEDIATE' ? 'IMMEDIATE' : 'END_OF_TERM';
  await request(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=${entitlementPolicy}&billingPolicy=END_OF_TERM`,
  );
}

export async function uncancelSubscription(subscriptionId: string): Promise<void> {
  await request('PUT', `/1.0/kb/subscriptions/${subscriptionId}/uncancel`);
}

/* -------------------------------------------------------------- invoices */

export interface InvoiceSummary {
  invoiceId: string;
  balanceMinor: number;
  amountMinor: number;
  currency: Currency;
}

interface RawInvoice {
  invoiceId: string;
  amount: number;
  balance: number;
  currency: string;
  invoiceNumber: string | null;
}

export async function readInvoice(invoiceId: string): Promise<InvoiceSummary> {
  const raw = await requestJson<RawInvoice>('GET', `/1.0/kb/invoices/${invoiceId}`);
  const currency = raw.currency as Currency;
  return {
    invoiceId: raw.invoiceId,
    balanceMinor: majorToMinor(raw.balance, currency),
    amountMinor: majorToMinor(raw.amount, currency),
    currency,
  };
}

export async function unpaidInvoices(accountId: string): Promise<InvoiceSummary[]> {
  const raw = await requestJson<RawInvoice[]>(
    'GET',
    `/1.0/kb/accounts/${accountId}/invoices?unpaidInvoicesOnly=true`,
  );
  return raw.map((invoice) => {
    const currency = invoice.currency as Currency;
    return {
      invoiceId: invoice.invoiceId,
      balanceMinor: majorToMinor(invoice.balance, currency),
      amountMinor: majorToMinor(invoice.amount, currency),
      currency,
    };
  });
}

export async function createExternalCharge(
  accountId: string,
  amountMinor: number,
  currency: Currency,
  description: string,
): Promise<string> {
  const items = await requestJson<{ invoiceId: string }[]>(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    [{ accountId, amount: Number(minorToMajor(amountMinor, currency)), currency, description }],
  );
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new Error('Kill Bill created no invoice for the external charge');
  return invoiceId;
}

export interface PaymentResult {
  paymentId: string;
  effectiveDateMs: number;
}

interface RawTransaction {
  transactionId: string;
  transactionType: string;
  amount: number;
  currency: string;
  status: string;
  effectiveDate: string;
}

interface RawPayment {
  paymentId: string;
  purchasedAmount: number;
  refundedAmount: number;
  currency: string;
  transactions: RawTransaction[];
}

export async function readPayment(paymentId: string): Promise<RawPayment> {
  return requestJson<RawPayment>('GET', `/1.0/kb/payments/${paymentId}`);
}

export async function payInvoice(
  accountId: string,
  invoiceId: string,
  amountMinor: number,
  currency: Currency,
): Promise<PaymentResult> {
  const raw = await request('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    json: {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: Number(minorToMajor(amountMinor, currency)),
      currency,
    },
  });
  const paymentId = idFromLocation(raw.location);
  const payment = await readPayment(paymentId);
  const purchase = payment.transactions.find(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
  if (!purchase) throw new Error('Kill Bill recorded no successful purchase transaction');
  return { paymentId, effectiveDateMs: Date.parse(purchase.effectiveDate) };
}

export interface RefundResult {
  refundId: string;
  effectiveDateMs: number;
}

export async function refundPayment(
  paymentId: string,
  amountMinor: number,
  currency: Currency,
): Promise<RefundResult> {
  const before = await readPayment(paymentId);
  const known = new Set(before.transactions.map((transaction) => transaction.transactionId));
  await request('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    json: { paymentId, amount: Number(minorToMajor(amountMinor, currency)), currency },
  });
  const after = await readPayment(paymentId);
  const refund = after.transactions.find(
    (transaction) =>
      transaction.transactionType === 'REFUND' && transaction.status === 'SUCCESS' && !known.has(transaction.transactionId),
  );
  if (!refund) throw new Error('Kill Bill confirmed no refund transaction');
  return { refundId: refund.transactionId, effectiveDateMs: Date.parse(refund.effectiveDate) };
}

export interface LedgerTransaction {
  type: 'PURCHASE' | 'REFUND';
  amountMinor: number;
  currency: Currency;
  effectiveDateMs: number;
}

/** Every successful purchase and refund on one account, for reconciliation. */
export async function readAccountTransactions(accountId: string): Promise<LedgerTransaction[]> {
  const payments = await requestJson<RawPayment[]>('GET', `/1.0/kb/accounts/${accountId}/payments`);
  const out: LedgerTransaction[] = [];
  for (const payment of payments) {
    for (const transaction of payment.transactions) {
      if (transaction.status !== 'SUCCESS') continue;
      if (transaction.transactionType !== 'PURCHASE' && transaction.transactionType !== 'REFUND') continue;
      const currency = transaction.currency as Currency;
      out.push({
        type: transaction.transactionType,
        amountMinor: majorToMinor(transaction.amount, currency),
        currency,
        effectiveDateMs: Date.parse(transaction.effectiveDate),
      });
    }
  }
  return out;
}

export async function reachable(): Promise<boolean> {
  try {
    await request('GET', '/1.0/kb/catalog');
    return true;
  } catch {
    return false;
  }
}
