import { config } from '../config.js';
import { AppError } from '../http/app-error.js';
import { formatMajorUnits, type CurrencyCode } from '../../shared/money.js';

export class BillingUnavailable extends AppError {
  constructor() {
    super('billing_unavailable');
  }
}

const CREATED_BY = 'gloamwork-shot-rig';
const EXTERNAL_PLUGIN = '__EXTERNAL_PAYMENT__';
export const BILLING_SERVICE = 'gloamwork-billing';

const headers = (): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
  'X-Killbill-ApiKey': config.killbill.apiKey,
  'X-Killbill-ApiSecret': config.killbill.apiSecret,
  'X-Killbill-CreatedBy': CREATED_BY,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

/** Marks a number that must reach Kill Bill with exactly the exponent's decimals. */
const AMOUNT_PREFIX = '@@amount:';

export const majorAmount = (amountMinor: bigint, currency: CurrencyCode): string =>
  `${AMOUNT_PREFIX}${formatMajorUnits(amountMinor, currency)}`;

const serialise = (body: unknown): string =>
  JSON.stringify(body).replace(
    new RegExp(`"${AMOUNT_PREFIX}(-?\\d+(?:\\.\\d+)?)"`, 'g'),
    (_match, digits: string) => digits,
  );

type Call = {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
};

const request = async ({ method, path, body, query }: Call): Promise<Response> => {
  const url = new URL(`${config.killbill.url}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  try {
    return await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : serialise(body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    });
  } catch {
    throw new BillingUnavailable();
  }
};

const call = async <T>({ method, path, body, query }: Call): Promise<T | null> => {
  const response = await request({ method, path, body, query });
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kill Bill ${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (text === '') {
    const location = response.headers.get('location');
    return location === null ? null : ({ location } as T);
  }
  return JSON.parse(text) as T;
};

const followLocation = async <T>(response: Response): Promise<T> => {
  const location = response.headers.get('location');
  if (location === null) throw new BillingUnavailable();
  const path = new URL(location, config.killbill.url).pathname;
  const result = await call<T>({ method: 'GET', path, query: { audit: 'NONE' } });
  if (result === null) throw new BillingUnavailable();
  return result;
};

const created = async <T>(input: Call): Promise<T> => {
  const response = await request(input);
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kill Bill ${input.method} ${input.path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  if (response.status === 201) return followLocation<T>(response);
  const text = await response.text();
  return (text === '' ? ({} as T) : (JSON.parse(text) as T));
};

export const billingUp = async (): Promise<boolean> => {
  try {
    const response = await request({ method: 'GET', path: '/1.0/healthcheck' });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
};

export type KbAccount = { accountId: string; externalKey: string; currency: string };

export const findAccountByExternalKey = async (externalKey: string): Promise<KbAccount | null> =>
  call<KbAccount>({
    method: 'GET',
    path: '/1.0/kb/accounts',
    query: { externalKey, audit: 'NONE' },
  });

export const createAccount = async (input: {
  externalKey: string;
  name: string;
  email: string;
  currency: CurrencyCode;
}): Promise<KbAccount> => {
  let account: KbAccount;
  try {
    account = await created<KbAccount>({
      method: 'POST',
      path: '/1.0/kb/accounts',
      body: {
        externalKey: input.externalKey,
        name: input.name,
        email: input.email,
        currency: input.currency,
      },
    });
  } catch (error) {
    const existing = await findAccountByExternalKey(input.externalKey);
    if (existing === null) throw error;
    return existing;
  }
  await created<unknown>({
    method: 'POST',
    path: `/1.0/kb/accounts/${account.accountId}/paymentMethods`,
    query: { isDefault: 'true' },
    body: { pluginName: EXTERNAL_PLUGIN, pluginInfo: {} },
  }).catch(() => undefined);
  return account;
};

export type KbInvoiceItem = { description: string; amount: number };

export type KbInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  balance: number;
  amount: number;
  status: string;
  items?: KbInvoiceItem[];
};

export const createExternalChargeInvoice = async (
  accountId: string,
  currency: CurrencyCode,
  lines: { description: string; amountMinor: bigint }[],
): Promise<KbInvoice> => {
  const response = await request({
    method: 'POST',
    path: `/1.0/kb/invoices/charges/${accountId}`,
    query: { autoCommit: 'true' },
    body: lines.map((line) => ({
      accountId,
      currency,
      description: line.description,
      amount: majorAmount(line.amountMinor, currency),
    })),
  });
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kill Bill charges -> ${response.status} ${text.slice(0, 300)}`);
  }
  const items = (await response.json()) as { invoiceId: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new BillingUnavailable();
  return getInvoice(invoiceId);
};

export const getInvoice = async (invoiceId: string): Promise<KbInvoice> => {
  const invoice = await call<KbInvoice>({
    method: 'GET',
    path: `/1.0/kb/invoices/${invoiceId}`,
    query: { withItems: 'true', audit: 'NONE' },
  });
  if (invoice === null) throw new BillingUnavailable();
  return invoice;
};

export const listAccountInvoices = async (accountId: string): Promise<KbInvoice[]> =>
  (await call<KbInvoice[]>({
    method: 'GET',
    path: `/1.0/kb/accounts/${accountId}/invoices`,
    query: { includeVoidedInvoices: 'true', audit: 'NONE' },
  })) ?? [];

export type KbTransaction = {
  transactionId: string;
  transactionType: string;
  status: string;
  amount: number;
  currency: string;
  transactionExternalKey: string;
};

export type KbPayment = {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KbTransaction[];
};

export const listInvoicePayments = async (invoiceId: string): Promise<KbPayment[]> =>
  (await call<KbPayment[]>({
    method: 'GET',
    path: `/1.0/kb/invoices/${invoiceId}/payments`,
    query: { audit: 'NONE' },
  })) ?? [];

const settledPurchase = (payments: readonly KbPayment[]): KbPayment | null =>
  payments.find(
    (payment) =>
      payment.purchasedAmount > 0 &&
      (payment.transactions === undefined ||
        payment.transactions.length === 0 ||
        payment.transactions.some(
          (entry) => entry.transactionType === 'PURCHASE' && entry.status === 'SUCCESS',
        )),
  ) ?? null;

/**
 * Records a purchase for the invoice's balance. Kill Bill keys instant payments itself, so
 * the invoice's own payment list is the authority, which also makes a retry reuse the
 * payment an interrupted attempt already captured.
 */
export const payInvoice = async (input: {
  accountId: string;
  invoiceId: string;
  amountMinor: bigint;
  currency: CurrencyCode;
}): Promise<KbPayment> => {
  const already = settledPurchase(await listInvoicePayments(input.invoiceId));
  if (already !== null) return already;

  const response = await request({
    method: 'POST',
    path: `/1.0/kb/invoices/${input.invoiceId}/payments`,
    query: { externalPayment: 'true' },
    body: {
      accountId: input.accountId,
      targetInvoiceId: input.invoiceId,
      purchasedAmount: majorAmount(input.amountMinor, input.currency),
      currency: input.currency,
    },
  });
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kill Bill pay -> ${response.status} ${text.slice(0, 300)}`);
  }
  if (response.status === 201) return followLocation<KbPayment>(response);
  await response.text().catch(() => '');
  const recorded = settledPurchase(await listInvoicePayments(input.invoiceId));
  if (recorded === null) throw new BillingUnavailable();
  return recorded;
};

export const getPayment = async (paymentId: string): Promise<KbPayment | null> =>
  call<KbPayment>({
    method: 'GET',
    path: `/1.0/kb/payments/${paymentId}`,
    query: { withAttempts: 'false', audit: 'NONE' },
  });

export const refundPayment = async (input: {
  paymentId: string;
  amountMinor: bigint;
  currency: CurrencyCode;
  transactionExternalKey: string;
}): Promise<KbPayment> =>
  created<KbPayment>({
    method: 'POST',
    path: `/1.0/kb/payments/${input.paymentId}/refunds`,
    body: {
      paymentId: input.paymentId,
      amount: majorAmount(input.amountMinor, input.currency),
      currency: input.currency,
      transactionExternalKey: input.transactionExternalKey,
    },
  });

export const voidInvoice = async (invoiceId: string): Promise<void> => {
  const response = await request({
    method: 'PUT',
    path: `/1.0/kb/invoices/${invoiceId}/voidInvoice`,
  });
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  await response.text().catch(() => '');
  // Kill Bill refuses to void an invoice it considers settled; nothing is left to void.
};

export const adjustInvoiceItemToZero = async (
  invoiceId: string,
  accountId: string,
  invoiceItemId: string,
): Promise<void> => {
  await created<unknown>({
    method: 'POST',
    path: `/1.0/kb/invoices/${invoiceId}/${invoiceItemId}/adjustments`,
    body: { accountId, invoiceItemId },
  });
};

export type KbInvoiceWithItemIds = KbInvoice & {
  items?: (KbInvoiceItem & { invoiceItemId: string; invoiceId: string })[];
};

export const getInvoiceWithItemIds = async (invoiceId: string): Promise<KbInvoiceWithItemIds> => {
  const invoice = await call<KbInvoiceWithItemIds>({
    method: 'GET',
    path: `/1.0/kb/invoices/${invoiceId}`,
    query: { withItems: 'true', audit: 'NONE' },
  });
  if (invoice === null) throw new BillingUnavailable();
  return invoice;
};

export const setBlockingState = async (
  accountId: string,
  stateName: 'OVERDUE' | 'CLEAR',
): Promise<void> => {
  const response = await request({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/block`,
    body: {
      stateName,
      service: BILLING_SERVICE,
      isBlockChange: false,
      isBlockEntitlement: false,
      isBlockBilling: stateName === 'OVERDUE',
    },
  });
  if (response.status >= 500) {
    await response.arrayBuffer().catch(() => undefined);
    throw new BillingUnavailable();
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`Kill Bill block -> ${response.status} ${text.slice(0, 300)}`);
};
