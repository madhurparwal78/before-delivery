/**
 * Kill Bill is the only record of money. Every figure the desk shows, renders into a
 * dispatch note or emails is read back from here, never kept from the desk's own
 * arithmetic. Any failure answers `billing_unavailable` and leaves nothing behind.
 */

import { config } from '../config';
import { minorFromPounds, poundsFromMinor } from '../domain/money';
import { BillingUnavailable } from './outages';

const REQUEST_TIMEOUT_MS = 10_000;

export interface InvoiceLine {
  description: string;
  amountMinor: number;
}

export interface Invoice {
  invoiceId: string;
  status: string;
  amountMinor: number;
  balanceMinor: number;
  lines: InvoiceLine[];
}

export interface PaymentTransaction {
  type: string;
  status: string;
  amountMinor: number;
}

export interface Payment {
  paymentId: string;
  transactions: PaymentTransaction[];
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'fittings-desk',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; location: string | null; text: string }> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BillingUnavailable(error);
  }
  if (response.status >= 500) throw new BillingUnavailable(new Error(`billing answered ${response.status}`));
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BillingUnavailable(error);
  }
}

function expectOk(answer: { status: number }, what: string): void {
  if (answer.status >= 400) throw new BillingUnavailable(new Error(`billing refused ${what}: ${answer.status}`));
}

function idFromLocation(location: string | null, what: string): string {
  const id = location?.replace(/\/+$/, '').split('/').pop();
  if (id === undefined || id === '') throw new BillingUnavailable(new Error(`billing gave no ${what} id`));
  return id;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * One account per claim, named and keyed only by the claim reference, so it carries no
 * personal data and can stay after the owner is erased.
 */
export async function accountForClaim(reference: string): Promise<string> {
  const found = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(reference)}`);
  if (found.status === 200) {
    const account = parse(found.text) as { accountId?: unknown };
    if (typeof account.accountId === 'string') return account.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    name: reference,
    externalKey: reference,
    currency: 'GBP',
  });
  if (created.status === 409) {
    const again = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(reference)}`);
    const account = parse(again.text) as { accountId?: unknown };
    if (typeof account.accountId === 'string') return account.accountId;
  }
  expectOk(created, 'account');
  return idFromLocation(created.location, 'account');
}

/** Each quote revision is one committed invoice holding the part line and the carriage line. */
export async function chargeInvoice(accountId: string, lines: readonly InvoiceLine[]): Promise<string> {
  const answer = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    lines.map((line) => ({
      accountId,
      amount: poundsFromMinor(line.amountMinor),
      currency: 'GBP',
      description: line.description,
    })),
  );
  expectOk(answer, 'invoice');
  const items = parse(answer.text) as { invoiceId?: unknown }[];
  const invoiceId = items[0]?.invoiceId;
  if (typeof invoiceId !== 'string') throw new BillingUnavailable(new Error('billing gave no invoice id'));
  return invoiceId;
}

export async function readInvoice(invoiceId: string): Promise<Invoice> {
  const answer = await call('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  expectOk(answer, 'invoice read');
  const invoice = parse(answer.text) as {
    invoiceId?: unknown;
    status?: unknown;
    amount?: unknown;
    balance?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  return {
    invoiceId: typeof invoice.invoiceId === 'string' ? invoice.invoiceId : invoiceId,
    status: typeof invoice.status === 'string' ? invoice.status : '',
    amountMinor: minorFromPounds(readNumber(invoice.amount)),
    balanceMinor: minorFromPounds(readNumber(invoice.balance)),
    lines: items.map((item) => {
      const line = item as { description?: unknown; amount?: unknown };
      return {
        description: typeof line.description === 'string' ? line.description : '',
        amountMinor: minorFromPounds(readNumber(line.amount)),
      };
    }),
  };
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  expectOk(await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`), 'void');
}

/** An external payment of the invoice's whole balance. */
export async function payInvoice(accountId: string, invoiceId: string, amountMinor: number): Promise<string> {
  const answer = await call('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId,
    purchasedAmount: poundsFromMinor(amountMinor),
    currency: 'GBP',
  });
  expectOk(answer, 'payment');
  return idFromLocation(answer.location, 'payment');
}

export async function readPayment(paymentId: string): Promise<Payment> {
  const answer = await call('GET', `/1.0/kb/payments/${paymentId}`);
  expectOk(answer, 'payment read');
  const payment = parse(answer.text) as { paymentId?: unknown; transactions?: unknown };
  const transactions = Array.isArray(payment.transactions) ? payment.transactions : [];
  return {
    paymentId: typeof payment.paymentId === 'string' ? payment.paymentId : paymentId,
    transactions: transactions.map((entry) => {
      const transaction = entry as { transactionType?: unknown; status?: unknown; amount?: unknown };
      return {
        type: typeof transaction.transactionType === 'string' ? transaction.transactionType : '',
        status: typeof transaction.status === 'string' ? transaction.status : '',
        amountMinor: minorFromPounds(readNumber(transaction.amount)),
      };
    }),
  };
}

export async function refundPayment(paymentId: string, amountMinor: number): Promise<void> {
  expectOk(
    await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      amount: poundsFromMinor(amountMinor),
      currency: 'GBP',
    }),
    'refund',
  );
}

export async function accountBalanceMinor(accountId: string): Promise<number> {
  const answer = await call('GET', `/1.0/kb/accounts/${accountId}?accountWithBalance=true`);
  expectOk(answer, 'account read');
  const account = parse(answer.text) as { accountBalance?: unknown };
  return minorFromPounds(readNumber(account.accountBalance));
}

/** The amount of the successful transaction of a type, as Kill Bill reports it. */
export function successfulAmountMinor(payment: Payment, type: 'PURCHASE' | 'REFUND'): number {
  const transaction = payment.transactions.find((entry) => entry.type === type && entry.status === 'SUCCESS');
  if (transaction === undefined) {
    throw new BillingUnavailable(new Error(`billing reports no successful ${type}`));
  }
  return transaction.amountMinor;
}
