import type { FeeLine, Tier } from '../../shared/types';
import { env } from '../env';
import { CATALOG_XML, planForTier } from './killbill-catalog';

export class BillingUnreachable extends Error {
  constructor(cause: string) {
    super(`Kill Bill is unreachable: ${cause}`);
    process.stderr.write(`${this.message}\n`);
  }
}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const CREATED_BY = 'pegworth-desk';

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(
  method: string,
  path: string,
  body?: { contentType: string; payload: string },
): Promise<KillBillResponse> {
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    accept: 'application/json',
  };
  if (body) headers['content-type'] = body.contentType;
  let response: Response;
  try {
    response = await fetch(`${env.killbill.url}${path}`, {
      method,
      headers,
      body: body?.payload,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new BillingUnreachable(error instanceof Error ? error.message : 'request failed');
  }
  const text = await response.text();
  if (response.status >= 500) {
    throw new BillingUnreachable(`${method} ${path} answered ${response.status}`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

async function getJson<T>(path: string): Promise<T | null> {
  const response = await call('GET', path);
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnreachable(`GET ${path} answered ${response.status}: ${response.text}`);
  }
  if (response.text.trim() === '') return null;
  return JSON.parse(response.text) as T;
}

async function postJson(path: string, payload: unknown): Promise<KillBillResponse> {
  const response = await call('POST', path, {
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnreachable(`POST ${path} answered ${response.status}: ${response.text}`);
  }
  return response;
}

function idFromLocation(response: KillBillResponse, resource: string): string {
  const location = response.location ?? '';
  const match = new RegExp(`/${resource}/([0-9a-fA-F-]{36})`).exec(location);
  if (!match?.[1]) {
    throw new BillingUnreachable(`no ${resource} id in location "${location}"`);
  }
  return match[1];
}

interface KbAccount {
  accountId: string;
  externalKey: string;
}

interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
}

interface KbBundle {
  subscriptions: KbSubscription[];
}

interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  subscriptionId: string | null;
  description: string | null;
  itemType: string;
}

interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  balance: number;
  amount: number;
  items: KbInvoiceItem[];
}

interface KbPaymentTransaction {
  transactionType: string;
  status: string;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  targetInvoiceId: string | null;
  transactions: KbPaymentTransaction[];
}

export async function ensureCatalog(): Promise<void> {
  const versions = await getJson<string[]>('/1.0/kb/catalog/versions');
  if (versions && versions.length > 0) return;
  const response = await call('POST', '/1.0/kb/catalog/xml', {
    contentType: 'text/xml',
    payload: CATALOG_XML,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnreachable(`catalog upload answered ${response.status}: ${response.text}`);
  }
}

export async function probeBilling(): Promise<void> {
  await getJson<string[]>('/1.0/kb/catalog/versions');
}

/** One account per member, keyed by their lowercased email; an existing one is reused. */
export async function ensureAccount(email: string, name: string): Promise<string> {
  const existing = await getJson<KbAccount>(
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(email)}`,
  );
  if (existing?.accountId) {
    await ensureAccountControls(existing.accountId);
    return existing.accountId;
  }
  const created = await postJson('/1.0/kb/accounts', {
    name,
    email,
    externalKey: email,
    currency: 'USD',
  });
  const accountId = idFromLocation(created, 'accounts');
  await ensureAccountControls(accountId);
  return accountId;
}

async function ensureAccountControls(accountId: string): Promise<void> {
  const methods = await getJson<{ pluginName: string; isDefault: boolean }[]>(
    `/1.0/kb/accounts/${accountId}/paymentMethods`,
  );
  if (!methods?.some((method) => method.pluginName === EXTERNAL_PAYMENT_PLUGIN)) {
    await postJson(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      pluginName: EXTERNAL_PAYMENT_PLUGIN,
      pluginInfo: {},
    });
  }
  const tags = await getJson<{ tagDefinitionId: string }[]>(`/1.0/kb/accounts/${accountId}/tags`);
  if (!tags?.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF_TAG)) {
    await postJson(`/1.0/kb/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  }
}

/** The account's active subscription to this plan, reused when one is already there. */
export async function ensureSubscription(accountId: string, tier: Tier): Promise<string> {
  const planName = planForTier(tier).plan;
  const existing = await findSubscription(accountId, planName);
  if (existing) return existing.subscriptionId;
  const created = await postJson(
    '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=20',
    { accountId, planName },
  );
  return idFromLocation(created, 'subscriptions');
}

async function findSubscription(
  accountId: string,
  planName: string,
): Promise<KbSubscription | null> {
  const bundles = await getJson<KbBundle[]>(`/1.0/kb/accounts/${accountId}/bundles`);
  for (const bundle of bundles ?? []) {
    for (const subscription of bundle.subscriptions ?? []) {
      if (subscription.planName === planName && subscription.state !== 'CANCELLED') {
        return subscription;
      }
    }
  }
  return null;
}

export async function readSubscription(subscriptionId: string): Promise<KbSubscription | null> {
  return getJson<KbSubscription>(`/1.0/kb/subscriptions/${subscriptionId}`);
}

/**
 * The subscription's first invoice. The account invoice list leaves items out,
 * so each candidate is read in full, oldest invoice number first.
 */
async function subscriptionFirstInvoice(
  accountId: string,
  subscriptionId: string,
): Promise<KbInvoice | null> {
  const listed = (await getJson<KbInvoice[]>(`/1.0/kb/accounts/${accountId}/invoices`)) ?? [];
  const ordered = [...listed].sort(
    (left, right) => Number(left.invoiceNumber ?? 0) - Number(right.invoiceNumber ?? 0),
  );
  for (const summary of ordered) {
    const invoice = await readInvoice(summary.invoiceId);
    if ((invoice?.items ?? []).some((item) => item.subscriptionId === subscriptionId)) {
      return invoice;
    }
  }
  return null;
}

async function paymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
  return getJson<KbPayment>(
    `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}&withPluginInfo=false`,
  );
}

function hasSuccessfulPurchase(payment: KbPayment | null): boolean {
  return (payment?.transactions ?? []).some(
    (transaction) =>
      transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
}

async function invoicePayments(invoiceId: string): Promise<KbPayment[]> {
  return (await getJson<KbPayment[]>(`/1.0/kb/invoices/${invoiceId}/payments`)) ?? [];
}

async function recordExternalPayment(
  accountId: string,
  invoiceId: string,
  amount: number,
  externalKey: string,
): Promise<void> {
  await postJson(
    `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
    { accountId, targetInvoiceId: invoiceId, purchasedAmount: amount, paymentExternalKey: externalKey },
  );
}

/** Records the join's first-year payment, reusing one an earlier attempt may have left. */
export async function ensureFirstYearPayment(
  accountId: string,
  subscriptionId: string,
): Promise<void> {
  const invoice = await subscriptionFirstInvoice(accountId, subscriptionId);
  if (!invoice) return;
  const existing = await invoicePayments(invoice.invoiceId);
  if (existing.some((payment) => hasSuccessfulPurchase(payment))) return;
  if (invoice.balance <= 0) return;
  await recordExternalPayment(
    accountId,
    invoice.invoiceId,
    invoice.balance,
    `pegworth-join-${accountId}`,
  );
}

export interface MembershipBillingState {
  subscriptionActive: boolean;
  firstInvoicePaid: boolean;
}

/** Kill Bill's own word on whether a membership may be recorded as active. */
export async function readMembershipBillingState(
  accountId: string,
  subscriptionId: string,
): Promise<MembershipBillingState> {
  const subscription = await readSubscription(subscriptionId);
  const invoice = await subscriptionFirstInvoice(accountId, subscriptionId);
  const payments = invoice ? await invoicePayments(invoice.invoiceId) : [];
  return {
    subscriptionActive: subscription?.state === 'ACTIVE',
    firstInvoicePaid:
      invoice !== null &&
      invoice.balance === 0 &&
      payments.some((payment) => hasSuccessfulPurchase(payment)),
  };
}

/** Cancels at end of term and reports the billing end date Kill Bill returns. */
export async function cancelAtEndOfTerm(subscriptionId: string): Promise<string | null> {
  const response = await call(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=false`,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnreachable(`cancel answered ${response.status}: ${response.text}`);
  }
  const subscription = await readSubscription(subscriptionId);
  return subscription?.billingEndDate ?? subscription?.chargedThroughDate ?? null;
}

/**
 * One invoice per fee, with one external charge item per fee line, in order.
 * The invoice is raised as a draft: Kill Bill only accepts a credit aimed at a
 * named invoice while it is a draft, and a waiver's credit has to clear this
 * fee's invoice rather than whichever of the member's invoices is oldest. It is
 * committed when the fee is paid or waived.
 */
export async function raiseFeeInvoice(
  accountId: string,
  lines: readonly FeeLine[],
): Promise<string> {
  const response = await postJson(
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
    lines.map((line) => ({
      accountId,
      amount: line.amount_cents / 100,
      currency: 'USD',
      description: line.description,
    })),
  );
  const items = JSON.parse(response.text) as KbInvoiceItem[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new BillingUnreachable('fee charges returned no invoice');
  return invoiceId;
}

async function commitInvoice(invoiceId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnreachable(`commit answered ${response.status}: ${response.text}`);
  }
}

export async function readInvoice(invoiceId: string): Promise<KbInvoice | null> {
  return getJson<KbInvoice>(`/1.0/kb/invoices/${invoiceId}?withItems=true`);
}

export function feePaymentExternalKey(feeId: number): string {
  return `pegworth-fee-${feeId}`;
}

export function waiverDescription(feeId: number): string {
  return `Waiver for fee ${feeId}`;
}

/**
 * Settles the fee's invoice with exactly one external payment, reusing one an
 * earlier unfinished attempt left under the fee's payment external key.
 */
export async function settleFeeInvoice(
  accountId: string,
  invoiceId: string,
  feeId: number,
): Promise<boolean> {
  const externalKey = feePaymentExternalKey(feeId);
  const raised = await readInvoice(invoiceId);
  if (raised?.status === 'DRAFT') await commitInvoice(invoiceId);
  const existing = await paymentByExternalKey(externalKey);
  const alreadyPaid =
    existing !== null && existing.targetInvoiceId === invoiceId && hasSuccessfulPurchase(existing);
  if (!alreadyPaid) {
    const invoice = await readInvoice(invoiceId);
    if (invoice && invoice.balance > 0) {
      await recordExternalPayment(accountId, invoiceId, invoice.balance, externalKey);
    }
  }
  const settled = await readInvoice(invoiceId);
  return settled !== null && settled.balance === 0;
}

/** Clears the fee's invoice with exactly one credit carrying the waiver description. */
export async function creditFeeInvoice(
  accountId: string,
  invoiceId: string,
  feeId: number,
  totalCents: number,
): Promise<boolean> {
  const description = waiverDescription(feeId);
  const raised = await readInvoice(invoiceId);
  const alreadyCredited = (raised?.items ?? []).some(
    (item) => item.itemType === 'CREDIT_ADJ' && item.description === description,
  );
  if (!alreadyCredited) {
    await postJson('/1.0/kb/credits?autoCommit=true', [
      { accountId, invoiceId, amount: totalCents / 100, currency: 'USD', description },
    ]);
  }
  if ((await readInvoice(invoiceId))?.status === 'DRAFT') await commitInvoice(invoiceId);
  const credited = await readInvoice(invoiceId);
  return credited !== null && credited.balance === 0;
}

export async function invoiceNumberOf(invoiceId: string): Promise<string> {
  const invoice = await readInvoice(invoiceId);
  return invoice?.invoiceNumber ?? invoiceId;
}
