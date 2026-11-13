import { env } from '../env';
import { PaymentDeclined, ProviderDown } from '../http/errors';
import { formatMoney } from '../../shared/labels';

const CREATED_BY = 'shelfmark';

interface KillBillAccount {
  accountId: string;
  accountBalance: number | null;
}

interface KillBillInvoice {
  invoiceId: string;
  balance: number;
  status: string;
}

interface KillBillInvoiceItem {
  invoiceId: string;
}

interface KillBillPaymentTransaction {
  transactionType: string;
  status: string;
  amount: number;
}

interface KillBillPayment {
  transactions: KillBillPaymentTransaction[];
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; location: string | null; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${env.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new ProviderDown('billing', error instanceof Error ? error.message : 'billing failed');
  }
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (response.status >= 500) {
    throw new ProviderDown('billing', `Kill Bill answered ${response.status}`);
  }
  return { status: response.status, location: response.headers.get('location'), json };
}

/** Dollar amounts cross the wire; cents are the only money we hold. */
function toDollars(cents: number): number {
  return Number(formatMoney(cents));
}

function toCents(dollars: number | null): number {
  return Math.round((dollars ?? 0) * 100);
}

async function findAccount(externalKey: string): Promise<KillBillAccount | null> {
  const found = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}&accountWithBalance=true`,
  );
  if (found.status === 404) return null;
  if (found.status !== 200) {
    throw new ProviderDown('billing', `account lookup answered ${found.status}`);
  }
  return found.json as KillBillAccount;
}

/** One account per member or guest piece, created once even under a race. */
export async function ensureAccount(args: {
  externalKey: string;
  name: string;
  email: string;
}): Promise<string> {
  const existing = await findAccount(args.externalKey);
  if (existing) return existing.accountId;

  const created = await call('POST', '/1.0/kb/accounts', {
    name: args.name,
    email: args.email,
    currency: 'USD',
    externalKey: args.externalKey,
  });
  const location = created.location;
  if (created.status === 201 && location) {
    return location.slice(location.lastIndexOf('/') + 1);
  }
  const afterRace = await findAccount(args.externalKey);
  if (afterRace) return afterRace.accountId;
  throw new ProviderDown('billing', `account create answered ${created.status}`);
}

export async function accountBalanceCents(accountId: string): Promise<number> {
  const result = await call('GET', `/1.0/kb/accounts/${accountId}?accountWithBalance=true`);
  if (result.status !== 200) {
    throw new ProviderDown('billing', `balance answered ${result.status}`);
  }
  return toCents((result.json as KillBillAccount).accountBalance);
}

/** Records one external charge, which creates one invoice. */
export async function postExternalCharge(args: {
  accountId: string;
  amountCents: number;
  description: string;
}): Promise<string> {
  const result = await call('POST', `/1.0/kb/invoices/charges/${args.accountId}?autoCommit=true`, [
    {
      accountId: args.accountId,
      amount: toDollars(args.amountCents),
      currency: 'USD',
      description: args.description,
    },
  ]);
  if (result.status !== 200 && result.status !== 201) {
    throw new ProviderDown('billing', `charge answered ${result.status}`);
  }
  const items = result.json as KillBillInvoiceItem[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new ProviderDown('billing', 'charge returned no invoice');
  return invoiceId;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const result = await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`, {});
  if (result.status !== 204 && result.status !== 200) {
    throw new ProviderDown('billing', `void answered ${result.status}`);
  }
}

async function unpaidInvoices(accountId: string): Promise<KillBillInvoice[]> {
  const result = await call(
    'GET',
    `/1.0/kb/accounts/${accountId}/invoices?unpaidInvoicesOnly=true`,
  );
  if (result.status !== 200) {
    throw new ProviderDown('billing', `invoice list answered ${result.status}`);
  }
  return (result.json as KillBillInvoice[]).filter((invoice) => invoice.balance > 0);
}

/** One PURCHASE for an invoice's whole balance, confirmed as SUCCESS. */
async function purchase(accountId: string, invoice: KillBillInvoice): Promise<number> {
  const result = await call(
    'POST',
    `/1.0/kb/invoices/${invoice.invoiceId}/payments?externalPayment=true`,
    {
      accountId,
      targetInvoiceId: invoice.invoiceId,
      purchasedAmount: invoice.balance,
    },
  );
  if (result.status !== 201 && result.status !== 200) {
    throw new PaymentDeclined(`payment answered ${result.status}`);
  }
  if (!result.location) throw new PaymentDeclined('payment was not recorded');
  const payment = await call('GET', new URL(result.location).pathname);
  if (payment.status !== 200) {
    throw new ProviderDown('billing', `payment read answered ${payment.status}`);
  }
  const settled = (payment.json as KillBillPayment).transactions
    .filter(
      (transaction) =>
        transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
    )
    .reduce((sum, transaction) => sum + Math.round(transaction.amount * 100), 0);
  if (settled < Math.round(invoice.balance * 100)) {
    throw new PaymentDeclined('Kill Bill did not accept the full amount');
  }
  return settled;
}

/** Records a PURCHASE for one invoice's whole balance. */
export async function payInvoiceFully(accountId: string, invoiceId: string): Promise<number> {
  const result = await call('GET', `/1.0/kb/invoices/${invoiceId}`);
  if (result.status !== 200) {
    throw new ProviderDown('billing', `invoice read answered ${result.status}`);
  }
  const invoice = result.json as KillBillInvoice;
  if (invoice.balance <= 0) throw new PaymentDeclined('nothing left to pay on this invoice');
  return purchase(accountId, invoice);
}

/**
 * Records a PURCHASE for an account's whole balance with Kill Bill's built-in
 * external payment method, and reports the cents it took.
 */
export async function payFullBalance(accountId: string): Promise<number> {
  const invoices = await unpaidInvoices(accountId);
  let paidCents = 0;
  for (const invoice of invoices) {
    paidCents += await purchase(accountId, invoice);
  }
  return paidCents;
}
