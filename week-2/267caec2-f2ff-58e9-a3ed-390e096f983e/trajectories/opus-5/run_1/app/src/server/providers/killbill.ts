import { config } from '../config';
import { TIER_LABEL } from '../domain/fees';
import type { FeeTier } from '../domain/types';

export class BillingUnavailableError extends Error {}

const CREATED_BY = 'cutline-jury-desk';
const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PLUGIN = '__EXTERNAL_PAYMENT__';

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': CREATED_BY,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<KillBillResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.providerTimeoutMs),
    });
  } catch (error) {
    throw new BillingUnavailableError(`billing request failed: ${String(error)}`);
  }
  const text = await response.text();
  if (response.status >= 500) {
    throw new BillingUnavailableError(`billing answered ${response.status}`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

async function expect(method: string, path: string, body: unknown, wanted: number[]): Promise<KillBillResponse> {
  const result = await call(method, path, body);
  if (!wanted.includes(result.status)) {
    throw new BillingUnavailableError(`${method} ${path} answered ${result.status}: ${result.text.slice(0, 300)}`);
  }
  return result;
}

function idFromLocation(result: KillBillResponse): string {
  const location = result.location;
  if (location === null) throw new BillingUnavailableError('billing answered without a Location header');
  return location.replace(/\/+$/, '').split('/').pop() as string;
}

function money(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export interface StudioAccount {
  studioId: string;
  name: string;
  email: string;
}

async function ensureAccount(studio: StudioAccount): Promise<string> {
  const externalKey = `cutline-studio-${studio.studioId}`;
  const found = await call('GET', `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 200) {
    return (JSON.parse(found.text) as { accountId: string }).accountId;
  }
  if (found.status !== 404) {
    throw new BillingUnavailableError(`account lookup answered ${found.status}`);
  }
  const created = await expect(
    'POST',
    '/accounts',
    { externalKey, name: studio.name, email: studio.email, currency: 'USD' },
    [201],
  );
  const accountId = idFromLocation(created);
  // Automatic payment would mint its own payment key; the desk pays each invoice itself.
  await expect('POST', `/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG], [201]);
  await expect(
    'POST',
    `/accounts/${accountId}/paymentMethods?isDefault=true`,
    { pluginName: EXTERNAL_PLUGIN, pluginInfo: {} },
    [201],
  );
  return accountId;
}

export interface EntryCharge {
  accountId: string;
  invoiceId: string;
  invoiceItemId: string;
  paymentId: string;
}

export interface ChargeRequest {
  studio: StudioAccount;
  entryId: string;
  entryNumber: number;
  tier: FeeTier;
  amountCents: number;
  /** Counts reversed attempts; a reversed payment keeps its external key in Kill Bill. */
  attempt: number;
}

export async function chargeEntryFee(request: ChargeRequest): Promise<EntryCharge> {
  const accountId = await ensureAccount(request.studio);
  const amount = money(request.amountCents);
  const description = `Entry ${request.entryNumber} — ${TIER_LABEL[request.tier]} entry fee`;
  const charged = await expect(
    'POST',
    `/invoices/charges/${accountId}?autoCommit=true`,
    [{ accountId, amount, currency: 'USD', description }],
    [200, 201],
  );
  const items = JSON.parse(charged.text) as { invoiceId: string; invoiceItemId: string }[];
  const invoiceId = items[0].invoiceId;
  const invoiceItemId = items[0].invoiceItemId;

  const suffix = request.attempt === 0 ? '' : `-${request.attempt}`;
  const paymentExternalKey = `cutline-entry-${request.entryId}${suffix}`;
  try {
    const paid = await expect(
      'POST',
      `/invoices/${invoiceId}/payments`,
      {
        accountId,
        targetInvoiceId: invoiceId,
        purchasedAmount: amount,
        currency: 'USD',
        paymentExternalKey,
      },
      [201],
    );
    return { accountId, invoiceId, invoiceItemId, paymentId: idFromLocation(paid) };
  } catch (error) {
    await adjustInvoiceToZero({ accountId, invoiceId, invoiceItemId, amountCents: request.amountCents });
    throw error;
  }
}

interface InvoiceRef {
  accountId: string;
  invoiceId: string;
  invoiceItemId: string;
  amountCents: number;
}

async function adjustInvoiceToZero(invoice: InvoiceRef): Promise<void> {
  await expect(
    'POST',
    `/invoices/${invoice.invoiceId}`,
    {
      accountId: invoice.accountId,
      invoiceId: invoice.invoiceId,
      invoiceItemId: invoice.invoiceItemId,
      amount: money(invoice.amountCents),
      currency: 'USD',
    },
    [200, 201],
  );
}

export interface RefundRequest {
  paymentId: string;
  invoiceItemId: string;
  amountCents: number;
}

/** Refunds the whole fee and writes off the charge, so the account balance returns to zero. */
export async function refundEntryFee(request: RefundRequest): Promise<void> {
  const amount = money(request.amountCents);
  await expect(
    'POST',
    `/invoicePayments/${request.paymentId}/refunds`,
    {
      paymentId: request.paymentId,
      amount,
      isAdjusted: true,
      adjustments: [{ invoiceItemId: request.invoiceItemId, amount }],
    },
    [200, 201],
  );
}
