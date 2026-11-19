import { config } from '../config.js';
import { callbackUrl } from '../domain/billingToken.js';
import { catalogXml } from './killbillCatalog.js';

/**
 * Generous for a payment call: charging and paying an invoice is several round
 * trips, and answering 503 on a slow-but-working Kill Bill would strand a hold.
 * A Kill Bill that is actually down refuses the connection and fails at once.
 */
const CALL_TIMEOUT_MS = 45_000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

export type PlanCode = 'studio-monthly' | 'pro-monthly';

/** Kill Bill could not be reached or answered with a server error. */
export class KillBillUnavailable extends Error {
  constructor(cause: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'KillBillUnavailable';
    this.cause = cause;
  }
}

const authHeader = `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64')}`;

function headers(contentType: string): Record<string, string> {
  return {
    authorization: authHeader,
    'X-Killbill-ApiKey': config.killbillApiKey,
    'X-Killbill-ApiSecret': config.killbillApiSecret,
    'X-Killbill-CreatedBy': 'phosphene-yard',
    'content-type': contentType,
  };
}

interface KillBillResponse {
  readonly status: number;
  readonly location: string | null;
  readonly body: unknown;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; xml?: string } = {},
): Promise<KillBillResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const hasXml = options.xml !== undefined;
    const response = await fetch(`${config.killbillUrl}${path}`, {
      method,
      headers: headers(hasXml ? 'text/xml' : 'application/json'),
      body: hasXml ? options.xml : options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: controller.signal,
    });
    if (response.status >= 500) {
      throw new KillBillUnavailable(`Kill Bill answered ${response.status}`);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, location: response.headers.get('location'), body };
  } catch (error) {
    if (error instanceof KillBillUnavailable) throw error;
    throw new KillBillUnavailable(error);
  } finally {
    clearTimeout(timer);
  }
}

function idFromLocation(location: string | null): string {
  const id = location?.replace(/\/$/, '').split('/').pop();
  if (!id) throw new KillBillUnavailable('Kill Bill returned no resource location');
  return id;
}

/**
 * The single boundary between our integer cents and Kill Bill's decimal wire
 * format. Nothing inside the app holds money as a fraction.
 */
function centsToDecimal(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function decimalToCents(amount: number): number {
  return Math.round(amount * 100);
}

export async function ensureCatalog(): Promise<void> {
  const versions = await call('GET', '/1.0/kb/catalog/versions');
  if (Array.isArray(versions.body) && versions.body.length > 0) return;
  await call('POST', '/1.0/kb/catalog/xml', { xml: catalogXml });
}

export async function registerCallback(): Promise<void> {
  await call(
    'POST',
    `/1.0/kb/tenants/registerNotificationCallback?cb=${encodeURIComponent(callbackUrl)}`,
  );
}

interface AccountBody {
  accountId?: string;
}

/**
 * One Kill Bill account per user, keyed by their Keycloak user id, with the
 * built-in external payment method as default.
 */
export async function ensureAccount(user: {
  id: string;
  displayName: string;
  email: string;
}): Promise<string> {
  const existing = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(user.id)}`,
  );
  if (existing.status === 200) {
    const accountId = (existing.body as AccountBody | null)?.accountId;
    if (accountId) return accountId;
  }

  const created = await call('POST', '/1.0/kb/accounts', {
    json: {
      externalKey: user.id,
      name: user.displayName,
      email: user.email,
      currency: 'USD',
      timeZone: 'UTC',
      billCycleDayLocal: 1,
    },
  });
  if (created.status !== 201) {
    const retry = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(user.id)}`);
    const accountId = (retry.body as AccountBody | null)?.accountId;
    if (accountId) return accountId;
    throw new KillBillUnavailable(`Kill Bill refused the account (${created.status})`);
  }

  const accountId = idFromLocation(created.location);
  await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    json: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
  });
  return accountId;
}

interface ChargeItem {
  invoiceId?: string;
}

export interface ChargeAndPayment {
  readonly invoiceId: string;
  readonly paymentId: string;
}

/** Charges the account and pays it with the external payment method. */
export async function chargeAndPay(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<ChargeAndPayment> {
  const charge = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    json: [{ amount: centsToDecimal(amountCents), currency: 'USD', description }],
  });
  const items = Array.isArray(charge.body) ? (charge.body as ChargeItem[]) : [];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) {
    throw new KillBillUnavailable(`Kill Bill refused the charge (${charge.status})`);
  }

  const payment = await call(
    'POST',
    `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
    { json: { accountId, targetInvoiceId: invoiceId, purchasedAmount: centsToDecimal(amountCents) } },
  );
  if (payment.status !== 201) {
    throw new KillBillUnavailable(`Kill Bill refused the payment (${payment.status})`);
  }

  return { invoiceId, paymentId: idFromLocation(payment.location) };
}

export interface InvoiceSummary {
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly balanceCents: number;
  readonly subscriptionIds: readonly string[];
}

interface InvoiceBody {
  invoiceId: string;
  amount?: number;
  balance?: number;
  items?: { subscriptionId?: string | null }[];
}

export async function getInvoice(invoiceId: string): Promise<InvoiceSummary | null> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  if (response.status !== 200) return null;
  const body = response.body as InvoiceBody;
  return {
    invoiceId: body.invoiceId,
    amountCents: decimalToCents(body.amount ?? 0),
    balanceCents: decimalToCents(body.balance ?? 0),
    subscriptionIds: (body.items ?? [])
      .map((item) => item.subscriptionId)
      .filter((id): id is string => typeof id === 'string'),
  };
}

export async function accountInvoiceIds(accountId: string): Promise<string[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (!Array.isArray(response.body)) return [];
  return (response.body as InvoiceBody[]).map((invoice) => invoice.invoiceId);
}

export type PaymentTransactionType = 'PURCHASE' | 'REFUND' | 'AUTHORIZE' | 'CAPTURE' | 'CREDIT' | 'VOID';
export type PaymentTransactionStatus = 'SUCCESS' | 'PENDING' | 'PAYMENT_FAILURE' | 'PLUGIN_FAILURE' | 'UNKNOWN';

export interface PaymentTransaction {
  readonly type: PaymentTransactionType;
  readonly status: PaymentTransactionStatus;
  readonly amountCents: number;
}

export interface Payment {
  readonly paymentId: string;
  readonly purchasedCents: number;
  readonly refundedCents: number;
  readonly transactions: readonly PaymentTransaction[];
}

interface PaymentBody {
  paymentId: string;
  purchasedAmount?: number;
  refundedAmount?: number;
  transactions?: { transactionType?: string; status?: string; amount?: number }[];
}

function readPayment(body: PaymentBody): Payment {
  return {
    paymentId: body.paymentId,
    purchasedCents: decimalToCents(body.purchasedAmount ?? 0),
    refundedCents: decimalToCents(body.refundedAmount ?? 0),
    transactions: (body.transactions ?? []).map((transaction) => ({
      type: (transaction.transactionType ?? 'UNKNOWN') as PaymentTransactionType,
      status: (transaction.status ?? 'UNKNOWN') as PaymentTransactionStatus,
      amountCents: decimalToCents(transaction.amount ?? 0),
    })),
  };
}

/** Re-reads an invoice's payments; the app acts only on what this read shows. */
export async function invoicePayments(invoiceId: string): Promise<Payment[]> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
  if (!Array.isArray(response.body)) return [];
  return (response.body as PaymentBody[]).map(readPayment);
}

export async function getPayment(paymentId: string): Promise<Payment | null> {
  const response = await call('GET', `/1.0/kb/payments/${paymentId}`);
  if (response.status !== 200) return null;
  return readPayment(response.body as PaymentBody);
}

/** Refunds against the original payment and reports whether Kill Bill made it. */
export async function refundPayment(paymentId: string, amountCents: number): Promise<boolean> {
  const response = await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    json: { amount: centsToDecimal(amountCents), currency: 'USD' },
  });
  if (response.status !== 201) {
    throw new KillBillUnavailable(`Kill Bill refused the refund (${response.status})`);
  }
  const payment = await getPayment(paymentId);
  return (
    payment?.transactions.some(
      (transaction) =>
        transaction.type === 'REFUND' &&
        transaction.status === 'SUCCESS' &&
        transaction.amountCents === amountCents,
    ) ?? false
  );
}

export async function createSubscription(accountId: string, planName: PlanCode): Promise<string> {
  const response = await call(
    'POST',
    '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=15',
    { json: { accountId, planName } },
  );
  if (response.status !== 201) {
    throw new KillBillUnavailable(`Kill Bill refused the subscription (${response.status})`);
  }
  return idFromLocation(response.location);
}

export interface SubscriptionDates {
  /** The billing end date Kill Bill reports after the cancel call. */
  readonly billingEndDate: string | null;
  readonly chargedThroughDate: string | null;
}

interface SubscriptionBody {
  billingEndDate?: string | null;
  chargedThroughDate?: string | null;
}

export async function getSubscription(subscriptionId: string): Promise<SubscriptionDates | null> {
  const response = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (response.status !== 200) return null;
  const body = response.body as SubscriptionBody;
  return {
    billingEndDate: body.billingEndDate ?? null,
    chargedThroughDate: body.chargedThroughDate ?? null,
  };
}

/** Cancels at end of term and reports the dates Kill Bill shows afterwards. */
export async function cancelSubscription(subscriptionId: string): Promise<SubscriptionDates> {
  const response = await call(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}?policy=END_OF_TERM&callCompletion=true&callTimeoutSec=15`,
  );
  if (response.status !== 204 && response.status !== 200) {
    throw new KillBillUnavailable(`Kill Bill refused the cancel (${response.status})`);
  }
  const dates = await getSubscription(subscriptionId);
  if (!dates) throw new KillBillUnavailable('Kill Bill lost the subscription after cancelling');
  return dates;
}

export async function probeKillBill(): Promise<boolean> {
  try {
    const response = await call('GET', '/1.0/kb/catalog/versions');
    return response.status < 500;
  } catch {
    return false;
  }
}
