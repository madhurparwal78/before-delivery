import { config } from '../config';

export class BillingUnavailable extends Error {
  constructor(detail: string) {
    super(`billing unavailable: ${detail}`);
    this.name = 'BillingUnavailable';
  }
}

const REQUEST_TIMEOUT_MS = 10000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'pilotlight',
    accept: 'application/json',
  };
}

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<KillBillResponse> {
  const headers = authHeaders();
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailable(`${method} ${path} unreachable`);
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

function parse<Shape>(response: KillBillResponse, path: string): Shape {
  try {
    return JSON.parse(response.text) as Shape;
  } catch {
    throw new BillingUnavailable(`${path} returned an unreadable body`);
  }
}

function idFromLocation(location: string | null, path: string): string {
  if (location === null) throw new BillingUnavailable(`${path} returned no location`);
  const parts = location.split('/').filter((part) => part.length > 0);
  const id = parts[parts.length - 1];
  if (id === undefined) throw new BillingUnavailable(`${path} returned no id`);
  return id;
}

interface KillBillAccount {
  accountId: string;
  paymentMethodId: string | null;
}

export interface MemberAccountInput {
  memberId: string;
  businessName: string;
  email: string;
}

async function findAccount(externalKey: string): Promise<KillBillAccount | null> {
  const response = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
  );
  if (response.status === 404) return null;
  if (response.status !== 200) throw new BillingUnavailable(`account lookup ${response.status}`);
  return parse<KillBillAccount>(response, 'account lookup');
}

async function ensureDefaultPaymentMethod(account: KillBillAccount): Promise<void> {
  if (account.paymentMethodId !== null) return;
  const response = await call(
    'POST',
    `/1.0/kb/accounts/${account.accountId}/paymentMethods?isDefault=true`,
    { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
  );
  if (response.status !== 201) {
    throw new BillingUnavailable(`payment method ${response.status}`);
  }
}

/** The member's Kill Bill account, looked up by external key and created only when absent. */
export async function ensureAccount(member: MemberAccountInput): Promise<string> {
  const existing = await findAccount(member.memberId);
  if (existing !== null) {
    await ensureDefaultPaymentMethod(existing);
    return existing.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: member.memberId,
    name: member.businessName,
    email: member.email,
    currency: 'USD',
  });
  if (created.status === 201) {
    const accountId = idFromLocation(created.location, 'account create');
    await ensureDefaultPaymentMethod({ accountId, paymentMethodId: null });
    return accountId;
  }
  const retried = await findAccount(member.memberId);
  if (retried === null) throw new BillingUnavailable(`account create ${created.status}`);
  await ensureDefaultPaymentMethod(retried);
  return retried.accountId;
}

export interface PurchaseInput {
  accountId: string;
  purchaseId: string;
  priceCents: number;
}

function amountFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/** One PURCHASE transaction for a pack. Returns the Kill Bill payment id. */
export async function purchasePack(input: PurchaseInput): Promise<string> {
  const response = await call('POST', `/1.0/kb/accounts/${input.accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: amountFromCents(input.priceCents),
    currency: 'USD',
    paymentExternalKey: input.purchaseId,
    transactionExternalKey: input.purchaseId,
  });
  if (response.status !== 201) throw new BillingUnavailable(`purchase ${response.status}`);
  return idFromLocation(response.location, 'purchase');
}

/** Undoes a charge when its ledger credit could not be stored. */
export async function refundPayment(paymentId: string, priceCents: number): Promise<void> {
  await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: amountFromCents(priceCents),
    currency: 'USD',
  }).catch(() => undefined);
}

export interface OverageInvoiceInput {
  accountId: string;
  totalCents: number;
  description: string;
}

interface KillBillInvoiceItem {
  invoiceId: string;
  itemType: string;
  amount: number;
  description: string;
}

interface KillBillInvoice {
  invoiceId: string;
  status: string;
  amount: number;
  items: KillBillInvoiceItem[];
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`).catch(() => undefined);
}

/**
 * One committed invoice holding exactly one external charge. A failure after the draft
 * exists voids it before the caller sees the outage.
 */
export async function createCommittedOverageInvoice(
  input: OverageInvoiceInput,
): Promise<string> {
  const created = await call('POST', `/1.0/kb/invoices/charges/${input.accountId}`, [
    {
      accountId: input.accountId,
      amount: amountFromCents(input.totalCents),
      currency: 'USD',
      description: input.description,
    },
  ]);
  if (created.status !== 200 && created.status !== 201) {
    throw new BillingUnavailable(`external charge ${created.status}`);
  }
  const items = parse<KillBillInvoiceItem[]>(created, 'external charge');
  const first = items[0];
  if (first === undefined) throw new BillingUnavailable('external charge returned no item');
  const invoiceId = first.invoiceId;
  try {
    const committed = await call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
    if (committed.status !== 204 && committed.status !== 200) {
      throw new BillingUnavailable(`commit ${committed.status}`);
    }
    const fetched = await call('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
    if (fetched.status !== 200) throw new BillingUnavailable(`invoice read ${fetched.status}`);
    const invoice = parse<KillBillInvoice>(fetched, 'invoice read');
    const charges = invoice.items.filter((item) => item.itemType === 'EXTERNAL_CHARGE');
    if (
      invoice.status !== 'COMMITTED' ||
      charges.length !== 1 ||
      Math.round(invoice.amount * 100) !== input.totalCents
    ) {
      throw new BillingUnavailable('invoice did not commit as sent');
    }
    return invoiceId;
  } catch (error) {
    await voidInvoice(invoiceId);
    throw error instanceof BillingUnavailable ? error : new BillingUnavailable('invoice failed');
  }
}
