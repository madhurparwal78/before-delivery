import { config } from '../config.ts';
import { billingUnavailable } from '../errors.ts';
import { centsToDecimalString, decimalStringToCents } from '../../shared/money.ts';

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const INVOICE_PAYMENT_CONTROL_PLUGIN = '__INVOICE_PAYMENT_CONTROL_PLUGIN__';
const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`, 'utf8').toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'earshot',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw billingUnavailable();
  }
}

async function readJson<Result>(response: Response): Promise<Result> {
  if (!response.ok) throw billingUnavailable();
  return (await response.json()) as Result;
}

function locationId(response: Response): string {
  const location = response.headers.get('location');
  const id = location === null ? null : (location.replace(/\/$/, '').split('/').pop() ?? null);
  if (id === null || id === '') throw billingUnavailable();
  return id;
}

export type KillBillInvoiceItem = {
  description: string;
  amount_cents: number;
  start_date: string;
};

export type KillBillInvoice = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  amount_cents: number;
  balance_cents: number;
  items: KillBillInvoiceItem[];
};

type RawInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amount: number | string;
  balance: number | string;
  items: Array<{ description: string | null; amount: number | string; startDate: string }> | null;
};

function toInvoice(raw: RawInvoice): KillBillInvoice {
  return {
    invoice_id: raw.invoiceId,
    invoice_number: raw.invoiceNumber,
    status: raw.status,
    amount_cents: decimalStringToCents(raw.amount),
    balance_cents: decimalStringToCents(raw.balance),
    items: (raw.items ?? []).map((item) => ({
      description: item.description ?? '',
      amount_cents: decimalStringToCents(item.amount),
      start_date: item.startDate,
    })),
  };
}

export async function findAccountId(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  const account = await readJson<{ accountId: string }>(response);
  return account.accountId;
}

/** Looks the account up first, then creates it, and reuses it when the key turns out to be taken. */
export async function findOrCreateAccount(input: {
  externalKey: string;
  name: string;
  email: string;
  company: string;
  timeZone: string;
}): Promise<string> {
  const existing = await findAccountId(input.externalKey);
  if (existing !== null) return existing;

  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: input.externalKey,
    name: input.name,
    email: input.email,
    company: input.company,
    currency: 'USD',
    timeZone: input.timeZone,
  });
  if (!created.ok) {
    const retried = await findAccountId(input.externalKey);
    if (retried !== null) return retried;
    throw billingUnavailable();
  }
  const accountId = locationId(created);

  const tagged = await call('POST', `/1.0/kb/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  if (!tagged.ok) throw billingUnavailable();
  const method = await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: EXTERNAL_PAYMENT_PLUGIN,
    pluginInfo: {},
  });
  if (!method.ok) throw billingUnavailable();
  return accountId;
}

export async function createExternalCharge(input: {
  accountId: string;
  amountCents: number;
  description: string;
  businessDate: string;
}): Promise<KillBillInvoice> {
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${input.accountId}?autoCommit=true&requestedDate=${input.businessDate}`,
    [
      {
        accountId: input.accountId,
        amount: Number(centsToDecimalString(input.amountCents)),
        currency: 'USD',
        description: input.description,
        startDate: input.businessDate,
      },
    ],
  );
  const items = await readJson<Array<{ invoiceId: string }>>(response);
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw billingUnavailable();
  return getInvoice(invoiceId);
}

export async function getInvoice(invoiceId: string): Promise<KillBillInvoice> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}`);
  return toInvoice(await readJson<RawInvoice>(response));
}

/** Every non-VOID invoice on the account, with its items. */
export async function listAccountInvoices(accountId: string): Promise<KillBillInvoice[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  const raw = await readJson<RawInvoice[]>(response);
  return raw.map(toInvoice).filter((invoice) => invoice.status !== 'VOID');
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`);
  if (!response.ok) throw billingUnavailable();
}

export type KillBillPayment = {
  payment_id: string;
  transaction_keys: string[];
};

export async function listAccountPayments(accountId: string): Promise<KillBillPayment[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/payments`);
  const raw = await readJson<
    Array<{
      paymentId: string;
      transactions: Array<{ transactionExternalKey: string; transactionType: string; status: string }>;
    }>
  >(response);
  return raw.map((payment) => ({
    payment_id: payment.paymentId,
    transaction_keys: payment.transactions
      .filter((transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS')
      .map((transaction) => transaction.transactionExternalKey),
  }));
}

export async function findInvoicePaymentId(invoiceId: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
  const raw = await readJson<Array<{ paymentId: string }>>(response);
  return raw[0]?.paymentId ?? null;
}

export async function recordPurchase(input: {
  accountId: string;
  invoiceId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<string> {
  const response = await call(
    'POST',
    `/1.0/kb/accounts/${input.accountId}/payments?controlPluginName=${INVOICE_PAYMENT_CONTROL_PLUGIN}` +
      `&pluginProperty=IPCD_INVOICE_ID%3D${input.invoiceId}`,
    {
      transactionExternalKey: input.transactionExternalKey,
      paymentExternalKey: `${input.transactionExternalKey}-payment`,
      transactionType: 'PURCHASE',
      amount: Number(centsToDecimalString(input.amountCents)),
      currency: 'USD',
    },
  );
  if (!response.ok) throw billingUnavailable();
  return locationId(response);
}
