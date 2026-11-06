import * as http from 'node:http';
import * as https from 'node:https';
import { config } from '../config';

export class BillingUnavailable extends Error {
  constructor() {
    super('Billing is unreachable');
  }
}

export class BillingRejected extends Error {
  constructor(readonly statusCode: number) {
    super(`Billing refused the request with status ${statusCode}`);
  }
}

const base = new URL(config.killbill.url);
const transport = base.protocol === 'https:' ? https : http;
const port = base.port !== '' ? Number.parseInt(base.port, 10) : base.protocol === 'https:' ? 443 : 80;
const CALL_TIMEOUT_MS = 10000;

interface KbResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(method: 'GET' | 'POST', path: string, payload: unknown): Promise<KbResponse> {
  const data = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), 'utf8');
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'lumenfold-dispatch',
  };
  if (data) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(data.length);
  }
  return new Promise<KbResponse>((resolve, reject) => {
    const request = transport.request(
      { host: base.hostname, port, method, path, headers, timeout: CALL_TIMEOUT_MS },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.setTimeout(CALL_TIMEOUT_MS, () => request.destroy(new Error('killbill timeout')));
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

async function request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<KbResponse> {
  let response: KbResponse;
  try {
    response = await call(method, path, payload);
  } catch {
    throw new BillingUnavailable();
  }
  if (response.statusCode >= 500) throw new BillingUnavailable();
  return response;
}

function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

interface KbInvoiceItem {
  description: string | null;
  itemType: string;
}

interface KbInvoice {
  invoiceId: string;
  status: string;
  balance: number;
  items?: KbInvoiceItem[];
}

interface KbPayment {
  paymentId: string;
  transactions: { transactionType: string; status: string }[];
}

export async function healthy(): Promise<boolean> {
  try {
    const response = await call('GET', '/1.0/healthcheck', undefined);
    return response.statusCode >= 200 && response.statusCode < 400;
  } catch {
    return false;
  }
}

export async function findAccount(externalKey: string): Promise<KbAccount | null> {
  const response = await request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.statusCode === 404) return null;
  if (response.statusCode !== 200) throw new BillingRejected(response.statusCode);
  return parseJson<KbAccount>(response.body);
}

export async function createAccount(externalKey: string, name: string): Promise<string> {
  const response = await request('POST', '/1.0/kb/accounts', { externalKey, name, currency: 'USD' });
  if (response.statusCode !== 201) throw new BillingRejected(response.statusCode);
  const location = response.headers.location;
  if (typeof location !== 'string') throw new BillingUnavailable();
  return location.slice(location.lastIndexOf('/') + 1);
}

/** Looks an account up by its external key, creating it with an external payment method when absent. */
export async function accountForTeam(teamId: string, teamName: string): Promise<string> {
  const existing = await findAccount(teamId);
  if (existing) {
    if (!existing.paymentMethodId) await addExternalPaymentMethod(existing.accountId);
    return existing.accountId;
  }
  const accountId = await createAccount(teamId, teamName);
  await addExternalPaymentMethod(accountId);
  return accountId;
}

async function addExternalPaymentMethod(accountId: string): Promise<void> {
  const response = await request('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: {},
  });
  if (response.statusCode !== 201) throw new BillingRejected(response.statusCode);
}

export async function findInvoiceByDescription(accountId: string, description: string): Promise<KbInvoice | null> {
  const list = await request('GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (list.statusCode !== 200) throw new BillingRejected(list.statusCode);
  const invoices = parseJson<KbInvoice[]>(list.body);
  for (const invoice of [...invoices].reverse()) {
    const detail = await request('GET', `/1.0/kb/invoices/${invoice.invoiceId}?withItems=true`);
    if (detail.statusCode !== 200) throw new BillingRejected(detail.statusCode);
    const full = parseJson<KbInvoice>(detail.body);
    if ((full.items ?? []).some((item) => item.description === description)) return full;
  }
  return null;
}

export async function createExternalCharge(
  accountId: string,
  amountUsd: number,
  description: string,
): Promise<string> {
  const response = await request('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
    { accountId, amount: amountUsd, currency: 'USD', description },
  ]);
  if (response.statusCode !== 200 && response.statusCode !== 201) throw new BillingRejected(response.statusCode);
  const items = parseJson<{ invoiceId: string }[]>(response.body);
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new BillingUnavailable();
  return invoiceId;
}

export async function successfulPurchaseOf(invoiceId: string): Promise<string | null> {
  const response = await request('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
  if (response.statusCode !== 200) throw new BillingRejected(response.statusCode);
  const payments = parseJson<KbPayment[]>(response.body);
  const paid = payments.find((payment) =>
    payment.transactions.some(
      (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
    ),
  );
  return paid ? paid.paymentId : null;
}

export async function payInvoice(accountId: string, invoiceId: string, amountUsd: number): Promise<string> {
  const response = await request('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: amountUsd,
  });
  if (response.statusCode !== 201 && response.statusCode !== 204) throw new BillingRejected(response.statusCode);
  const paymentId = await successfulPurchaseOf(invoiceId);
  if (!paymentId) throw new BillingUnavailable();
  return paymentId;
}
