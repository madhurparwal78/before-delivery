import { config } from '../config.js';

export class PaymentUnavailable extends Error {}

const WRITTEN_OFF_TAG = '00000000-0000-0000-0000-000000000004';
const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

function headers(): Record<string, string> {
  const basic = Buffer.from(
    `${config.killbill.username}:${config.killbill.password}`,
    'utf8',
  ).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'kerf-frequencies',
  };
}

interface CallResult {
  status: number;
  location: string | null;
  body: unknown;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PaymentUnavailable('killbill unreachable');
  }
  const text = await response.text();
  if (response.status >= 500) throw new PaymentUnavailable(`killbill ${response.status}`);
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), body: parsed };
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const match = /\/([0-9a-f-]{36})\/?$/.exec(location);
  return match?.[1] ?? null;
}

function euros(cents: number): number {
  return Math.round(cents) / 100;
}

export interface KillBillTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amountCents: number;
  status: string;
}

interface PaymentJson {
  paymentId: string;
  paymentExternalKey: string;
  transactions: Array<{
    transactionId: string;
    transactionExternalKey: string;
    transactionType: string;
    amount: number | null;
    status: string;
  }>;
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(4000),
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureAccount(
  externalKey: string,
  name: string,
  blockAutoPay: boolean,
): Promise<string> {
  const existing = await call('GET', `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (existing.status === 200 && existing.body !== null) {
    const account = existing.body as { accountId: string };
    return account.accountId;
  }
  const created = await call('POST', '/accounts', {
    externalKey,
    currency: 'EUR',
    name,
  });
  const accountId = idFromLocation(created.location);
  if (accountId === null) throw new PaymentUnavailable('account creation returned no id');
  await call('POST', `/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: EXTERNAL_PAYMENT_PLUGIN,
    pluginInfo: {},
  });
  if (blockAutoPay) {
    await call('POST', `/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  }
  return accountId;
}

async function paymentByExternalKey(externalKey: string): Promise<PaymentJson | null> {
  const found = await call(
    'GET',
    `/payments?externalKey=${encodeURIComponent(externalKey)}&withPluginInfo=false`,
  );
  if (found.status !== 200 || found.body === null) return null;
  return found.body as PaymentJson;
}

function transactionOf(payment: PaymentJson, externalKey: string): KillBillTransaction | null {
  const match = payment.transactions.find(
    (transaction) => transaction.transactionExternalKey === externalKey,
  );
  if (match === undefined) return null;
  return {
    transactionId: match.transactionId,
    transactionExternalKey: match.transactionExternalKey,
    transactionType: match.transactionType,
    amountCents: Math.round((match.amount ?? 0) * 100),
    status: match.status,
  };
}

export interface AuthorizeResult {
  paymentId: string;
  transaction: KillBillTransaction;
}

export async function authorize(
  accountId: string,
  orderRef: string,
  amountCents: number,
): Promise<AuthorizeResult> {
  const transactionKey = `${orderRef}-auth`;
  const existing = await paymentByExternalKey(orderRef);
  const already = existing === null ? null : transactionOf(existing, transactionKey);
  if (existing !== null && already !== null) {
    return { paymentId: existing.paymentId, transaction: already };
  }
  const created = await call('POST', `/accounts/${accountId}/payments`, {
    transactionType: 'AUTHORIZE',
    amount: euros(amountCents),
    currency: 'EUR',
    paymentExternalKey: orderRef,
    transactionExternalKey: transactionKey,
  });
  const paymentId = idFromLocation(created.location);
  if (paymentId === null) throw new PaymentUnavailable('authorise returned no payment id');
  const payment = await loadPayment(paymentId);
  const transaction = transactionOf(payment, transactionKey);
  if (transaction === null) throw new PaymentUnavailable('authorise transaction missing');
  return { paymentId, transaction };
}

async function loadPayment(paymentId: string): Promise<PaymentJson> {
  const found = await call('GET', `/payments/${paymentId}`);
  if (found.status !== 200 || found.body === null) {
    throw new PaymentUnavailable(`payment ${paymentId} not readable`);
  }
  return found.body as PaymentJson;
}

async function addTransaction(
  paymentId: string,
  path: string,
  transactionKey: string,
  amountCents: number | null,
): Promise<KillBillTransaction> {
  const before = await loadPayment(paymentId);
  const already = transactionOf(before, transactionKey);
  if (already !== null) return already;
  const body: Record<string, unknown> = { transactionExternalKey: transactionKey, currency: 'EUR' };
  if (amountCents !== null) body['amount'] = euros(amountCents);
  await call('POST', path, body);
  const after = await loadPayment(paymentId);
  const transaction = transactionOf(after, transactionKey);
  if (transaction === null) throw new PaymentUnavailable(`transaction ${transactionKey} missing`);
  return transaction;
}

export async function capture(
  paymentId: string,
  orderRef: string,
  amountCents: number,
): Promise<KillBillTransaction> {
  return addTransaction(paymentId, `/payments/${paymentId}`, `${orderRef}-capture`, amountCents);
}

export async function voidPayment(
  paymentId: string,
  orderRef: string,
): Promise<KillBillTransaction> {
  const transactionKey = `${orderRef}-void`;
  const before = await loadPayment(paymentId);
  const already = transactionOf(before, transactionKey);
  if (already !== null) return already;
  await call('DELETE', `/payments/${paymentId}`, { transactionExternalKey: transactionKey });
  const after = await loadPayment(paymentId);
  const transaction = transactionOf(after, transactionKey);
  if (transaction === null) throw new PaymentUnavailable('void transaction missing');
  return transaction;
}

export async function refund(
  paymentId: string,
  refundId: string,
  amountCents: number,
): Promise<KillBillTransaction> {
  return addTransaction(paymentId, `/payments/${paymentId}/refunds`, refundId, amountCents);
}

export interface InvoiceItemRequest {
  lineId: string;
  description: string;
  amountCents: number;
}

export interface CreatedInvoice {
  invoiceId: string;
  items: Array<{ lineId: string; killBillItemId: string }>;
}

export async function createInvoiceFromCharges(
  accountId: string,
  items: readonly InvoiceItemRequest[],
): Promise<CreatedInvoice> {
  const created = await call(
    'POST',
    `/invoices/charges/${accountId}?autoCommit=true`,
    items.map((item) => ({
      accountId,
      amount: euros(item.amountCents),
      currency: 'EUR',
      description: item.description,
    })),
  );
  const rows = (created.body ?? []) as Array<{ invoiceId: string; invoiceItemId: string; description: string }>;
  const invoiceId = rows[0]?.invoiceId;
  if (invoiceId === undefined) throw new PaymentUnavailable('invoice creation returned no id');
  return {
    invoiceId,
    items: items.map((item, index) => ({
      lineId: item.lineId,
      killBillItemId: rows[index]?.invoiceItemId ?? '',
    })),
  };
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/invoices/${invoiceId}/voidInvoice`);
}

export interface CollectionResult {
  paymentId: string;
  transaction: KillBillTransaction;
}

export async function collectInvoice(
  invoiceId: string,
  accountId: string,
  amountCents: number,
  paymentExternalKey: string,
): Promise<CollectionResult> {
  const existing = await paymentByExternalKey(paymentExternalKey);
  if (existing !== null) {
    const purchase = existing.transactions.find(
      (transaction) => transaction.transactionType === 'PURCHASE',
    );
    if (purchase !== undefined) {
      return {
        paymentId: existing.paymentId,
        transaction: {
          transactionId: purchase.transactionId,
          transactionExternalKey: purchase.transactionExternalKey,
          transactionType: purchase.transactionType,
          amountCents: Math.round((purchase.amount ?? 0) * 100),
          status: purchase.status,
        },
      };
    }
  }
  await call('POST', `/invoices/${invoiceId}/payments`, {
    targetInvoiceId: invoiceId,
    accountId,
    purchasedAmount: euros(amountCents),
    currency: 'EUR',
    paymentExternalKey,
  });
  const payment = await paymentByExternalKey(paymentExternalKey);
  const purchase = payment?.transactions.find(
    (transaction) => transaction.transactionType === 'PURCHASE',
  );
  if (payment === null || payment === undefined || purchase === undefined) {
    throw new PaymentUnavailable('collection transaction missing');
  }
  return {
    paymentId: payment.paymentId,
    transaction: {
      transactionId: purchase.transactionId,
      transactionExternalKey: purchase.transactionExternalKey,
      transactionType: purchase.transactionType,
      amountCents: Math.round((purchase.amount ?? 0) * 100),
      status: purchase.status,
    },
  };
}

export async function chargeback(
  paymentId: string,
  amountCents: number,
  transactionKey: string,
): Promise<KillBillTransaction> {
  // The invoicePayments endpoint is the one that puts the balance back on the invoice.
  return addTransaction(
    paymentId,
    `/invoicePayments/${paymentId}/chargebacks`,
    transactionKey,
    amountCents,
  );
}

export async function adjustInvoiceItem(
  invoiceId: string,
  invoiceItemId: string,
  accountId: string,
  amountCents: number,
): Promise<void> {
  await call('POST', `/invoices/${invoiceId}`, {
    invoiceItemId,
    accountId,
    amount: euros(amountCents),
    currency: 'EUR',
  });
}

export async function writeOffInvoice(invoiceId: string): Promise<void> {
  await call('POST', `/invoices/${invoiceId}/tags`, [WRITTEN_OFF_TAG]);
}

export interface ScannedTransaction extends KillBillTransaction {
  accountExternalKey: string;
  paymentExternalKey: string;
}

export async function scanKerfTransactions(): Promise<ScannedTransaction[]> {
  const accounts: Array<{ accountId: string; externalKey: string | null }> = [];
  for (let offset = 0; ; offset += 100) {
    const page = await call('GET', `/accounts/pagination?offset=${offset}&limit=100`);
    const rows = (page.body ?? []) as Array<{ accountId: string; externalKey: string | null }>;
    accounts.push(...rows);
    if (rows.length < 100) break;
  }

  const transactions: ScannedTransaction[] = [];
  for (const account of accounts) {
    const externalKey = account.externalKey ?? '';
    if (!externalKey.startsWith('kerf-')) continue;
    const payments = await call('GET', `/accounts/${account.accountId}/payments`);
    const rows = (payments.body ?? []) as PaymentJson[];
    for (const payment of rows) {
      for (const transaction of payment.transactions) {
        transactions.push({
          accountExternalKey: externalKey,
          paymentExternalKey: payment.paymentExternalKey,
          transactionId: transaction.transactionId,
          transactionExternalKey: transaction.transactionExternalKey,
          transactionType: transaction.transactionType,
          amountCents: Math.round((transaction.amount ?? 0) * 100),
          status: transaction.status,
        });
      }
    }
  }
  return transactions;
}
