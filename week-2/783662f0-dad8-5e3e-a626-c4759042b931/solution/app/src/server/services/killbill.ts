import { config } from '../config.js';
import { PLANS, PLAN_IDS, type PlanId } from '../../shared/domain.js';
import { money } from '../util.js';

/** The AUTO_PAY_OFF control tag definition id. */
const AUTO_PAY_OFF = '00000000-0000-0000-0000-000000000001';

export class BillingUnreachable extends Error {}

/** Kill Bill answered, and refused the request: a 4xx is never an outage. */
export class BillingRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface KbInvoiceItem {
  readonly invoiceItemId: string;
  readonly itemType: string;
  readonly amount: number;
  readonly planName: string | null;
  readonly description: string | null;
}

export interface KbInvoice {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly invoiceDate: string;
  readonly amount: number;
  readonly balance: number;
  readonly status: string;
  readonly items: readonly KbInvoiceItem[];
}

export interface KbTransaction {
  readonly transactionType: string;
  readonly status: string;
  readonly effectiveDate: string;
  readonly amount: number;
}

export interface KbPayment {
  readonly paymentId: string;
  readonly paymentExternalKey: string;
  readonly purchasedAmount: number;
  readonly refundedAmount: number;
  readonly transactions: readonly KbTransaction[];
}

interface KbSubscriptionEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly effectiveDate: string;
  readonly plan: string | null;
}

interface KbSubscription {
  readonly subscriptionId: string;
  readonly planName: string;
  readonly events: readonly KbSubscriptionEvent[];
}

export interface KbAccountState {
  readonly accountId: string;
  readonly balance: number;
  readonly invoices: readonly KbInvoice[];
  readonly payments: readonly KbPayment[];
}

interface RequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly contentType?: string;
  readonly rawBody?: string;
  /** 404 answers null instead of throwing. */
  readonly allowMissing?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10000;

/** Every Kill Bill resource path is relative to this API root. */
const API_ROOT = '/1.0/kb';

function headers(contentType: string): Record<string, string> {
  const kb = config().killbill;
  const basic = Buffer.from(`${kb.username}:${kb.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': kb.apiKey,
    'X-Killbill-ApiSecret': kb.apiSecret,
    'X-Killbill-CreatedBy': 'plotwright',
    'Content-Type': contentType,
    Accept: 'application/json',
  };
}

interface KbResponse {
  readonly status: number;
  readonly location: string | null;
  readonly json: unknown;
}

async function call(options: RequestOptions): Promise<KbResponse | null> {
  const kb = config().killbill;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: options.method,
      headers: headers(options.contentType ?? 'application/json'),
      signal: controller.signal,
    };
    if (options.rawBody !== undefined) init.body = options.rawBody;
    else if (options.body !== undefined) init.body = JSON.stringify(options.body);

    const response = await fetch(`${kb.url}${API_ROOT}${options.path}`, init);
    if (response.status === 404 && options.allowMissing === true) return null;
    if (response.status >= 500) {
      throw new BillingUnreachable(`Kill Bill answered ${response.status}`);
    }
    const text = await response.text();
    let json: unknown = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (response.status >= 400) {
      throw new BillingRefused(
        response.status,
        `Kill Bill refused ${options.method} ${options.path} with ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    return { status: response.status, location: response.headers.get('location'), json };
  } catch (error) {
    if (error instanceof BillingUnreachable || error instanceof BillingRefused) throw error;
    throw new BillingUnreachable(`Kill Bill is unreachable: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

const idFromLocation = (location: string | null): string => {
  if (location === null) throw new BillingUnreachable('Kill Bill sent no Location header');
  return location.replace(/\/$/, '').split('/').pop() ?? '';
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** At start, upload the catalog when the tenant has none. */
export async function ensureCatalog(): Promise<void> {
  const response = await call({ method: 'GET', path: '/catalog' });
  const versions = asArray(response?.json);
  const products = versions.flatMap((version) => asArray(asRecord(version).products));
  const planNames = new Set(
    products.flatMap((product) =>
      asArray(asRecord(product).plans).map((plan) => str(asRecord(plan).name)),
    ),
  );
  for (const planId of PLAN_IDS) {
    const plan = PLANS[planId];
    if (planNames.has(plan.killbillPlan)) continue;
    await call({
      method: 'POST',
      path: '/catalog/simplePlan',
      body: {
        planId: plan.killbillPlan,
        productName: plan.product,
        productCategory: 'BASE',
        currency: 'USD',
        amount: Number(plan.price),
        billingPeriod: 'MONTHLY',
        trialLength: 0,
        trialTimeUnit: 'UNLIMITED',
      },
    });
  }
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await call({
    method: 'GET',
    path: `/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    allowMissing: true,
  });
  if (response === null) return null;
  const id = strOrNull(asRecord(response.json).accountId);
  return id;
}

async function createAccount(externalKey: string, name: string): Promise<string> {
  const response = await call({
    method: 'POST',
    path: '/accounts',
    body: { externalKey, name, currency: 'USD' },
  });
  return idFromLocation(response?.location ?? null);
}

/** Finds the account by external key, creating it when it does not exist yet. */
export async function ensureAccount(externalKey: string, name: string): Promise<string> {
  const found = await findAccount(externalKey);
  if (found !== null) return found;
  return createAccount(externalKey, name);
}

export async function ensureAutoPayOff(accountId: string): Promise<void> {
  const response = await call({ method: 'GET', path: `/accounts/${accountId}/tags` });
  const already = asArray(response?.json).some(
    (tag) => str(asRecord(tag).tagDefinitionId) === AUTO_PAY_OFF,
  );
  if (already) return;
  await call({
    method: 'POST',
    path: `/accounts/${accountId}/tags`,
    body: [AUTO_PAY_OFF],
  });
}

export async function findSubscription(externalKey: string): Promise<KbSubscription | null> {
  const response = await call({
    method: 'GET',
    path: `/subscriptions?externalKey=${encodeURIComponent(externalKey)}`,
    allowMissing: true,
  });
  if (response === null) return null;
  const record = asRecord(response.json);
  const id = strOrNull(record.subscriptionId);
  if (id === null) return null;
  return readSubscription(record);
}

function readSubscription(record: Record<string, unknown>): KbSubscription {
  return {
    subscriptionId: str(record.subscriptionId),
    planName: str(record.planName),
    events: asArray(record.events).map((event) => {
      const row = asRecord(event);
      return {
        eventId: str(row.eventId),
        eventType: str(row.eventType),
        effectiveDate: str(row.effectiveDate),
        plan: strOrNull(row.plan),
      };
    }),
  };
}

export async function ensureSubscription(
  accountId: string,
  externalKey: string,
  plan: PlanId,
): Promise<KbSubscription> {
  const existing = await findSubscription(externalKey);
  if (existing !== null) return existing;
  await call({
    method: 'POST',
    path: '/subscriptions?callCompletion=true&callTimeoutSec=10',
    body: { accountId, externalKey, planName: PLANS[plan].killbillPlan },
  });
  const created = await findSubscription(externalKey);
  if (created === null) throw new BillingUnreachable('Kill Bill made no subscription');
  return created;
}

/** Kill Bill changes the subscription at once and invoices the difference. */
export async function changePlan(subscriptionId: string, plan: PlanId): Promise<void> {
  await call({
    method: 'PUT',
    path: `/subscriptions/${subscriptionId}?policy=IMMEDIATE&callCompletion=true&callTimeoutSec=10`,
    body: { planName: PLANS[plan].killbillPlan },
  });
}

function readInvoice(value: unknown): KbInvoice {
  const record = asRecord(value);
  return {
    invoiceId: str(record.invoiceId),
    invoiceNumber: num(record.invoiceNumber),
    invoiceDate: str(record.invoiceDate),
    amount: num(record.amount),
    balance: num(record.balance),
    status: str(record.status),
    items: asArray(record.items).map((item) => {
      const row = asRecord(item);
      return {
        invoiceItemId: str(row.invoiceItemId),
        itemType: str(row.itemType),
        amount: num(row.amount),
        planName: strOrNull(row.planName),
        description: strOrNull(row.description),
      };
    }),
  };
}

/** The account balance alone: the one read the background check needs first. */
export async function accountBalance(accountId: string): Promise<number> {
  const account = await call({
    method: 'GET',
    path: `/accounts/${accountId}?accountWithBalance=true`,
  });
  return num(asRecord(account?.json).accountBalance);
}

/**
 * The account as Kill Bill holds it, in three reads: the balance, every
 * invoice with its items, and every payment.
 */
export async function accountState(accountId: string): Promise<KbAccountState> {
  const balance = await accountBalance(accountId);
  const list = await call({
    method: 'GET',
    path: `/accounts/${accountId}/invoices?includeInvoiceComponents=true`,
  });
  const invoices = asArray(list?.json)
    .map(readInvoice)
    .filter((invoice) => invoice.invoiceId !== '')
    .sort((a, b) => a.invoiceNumber - b.invoiceNumber);

  const paymentsResponse = await call({
    method: 'GET',
    path: `/accounts/${accountId}/payments`,
  });
  const payments = asArray(paymentsResponse?.json).map(readPayment);

  return { accountId, balance, invoices, payments };
}

function readPayment(value: unknown): KbPayment {
  const record = asRecord(value);
  return {
    paymentId: str(record.paymentId),
    paymentExternalKey: str(record.paymentExternalKey),
    purchasedAmount: num(record.purchasedAmount),
    refundedAmount: num(record.refundedAmount),
    transactions: asArray(record.transactions).map((transaction) => {
      const row = asRecord(transaction);
      return {
        transactionType: str(row.transactionType),
        status: str(row.status),
        effectiveDate: str(row.effectiveDate),
        amount: num(row.amount),
      };
    }),
  };
}

export async function paymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
  const response = await call({
    method: 'GET',
    path: `/payments?externalKey=${encodeURIComponent(externalKey)}`,
    allowMissing: true,
  });
  if (response === null) return null;
  const record = asRecord(response.json);
  if (strOrNull(record.paymentId) === null) return null;
  return readPayment(record);
}

export const paymentSucceeded = (payment: KbPayment): boolean =>
  payment.transactions.some(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );

/**
 * An external payment of the invoice's full balance. The call is given its own
 * timeout so that a slow provider can be recorded as pending.
 */
export async function payInvoice(
  accountId: string,
  invoiceId: string,
  amount: number,
  externalKey: string,
  timeoutMs: number,
): Promise<void> {
  await call({
    method: 'POST',
    path: `/invoices/${invoiceId}/payments?externalPayment=true`,
    body: {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: Number(money(amount)),
      paymentExternalKey: externalKey,
      currency: 'USD',
    },
    timeoutMs,
  });
}

export async function addExternalCharge(
  accountId: string,
  amount: string,
  description: string,
): Promise<string> {
  const response = await call({
    method: 'POST',
    path: `/invoices/charges/${accountId}?autoCommit=true`,
    body: [{ accountId, amount: Number(amount), currency: 'USD', description }],
  });
  const items = asArray(response?.json);
  const invoiceId = strOrNull(asRecord(items[0]).invoiceId);
  if (invoiceId === null) throw new BillingUnreachable('Kill Bill made no external charge');
  return invoiceId;
}

export async function refundPayment(
  paymentId: string,
  amount: string,
  transactionExternalKey: string,
): Promise<void> {
  await call({
    method: 'POST',
    path: `/payments/${paymentId}/refunds`,
    body: { amount: Number(amount), transactionExternalKey },
  });
}

