import { config } from '../config.js';

export class BillingUnreachable extends Error {}

export interface InvoiceCharge {
  readonly description: string;
  readonly amount: string;
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'tidewright',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new BillingUnreachable(`Kill Bill is unreachable: ${String(error)}`);
  }
}

async function createAccount(options: {
  readonly externalKey: string;
  readonly name: string;
  readonly email: string;
  readonly currency: string;
}): Promise<string> {
  const response = await call('POST', '/1.0/kb/accounts', {
    externalKey: options.externalKey,
    name: options.name,
    email: options.email,
    currency: options.currency,
  });
  const location = response.headers.get('location');
  if (response.ok && location !== null) return location.slice(location.lastIndexOf('/') + 1);
  await response.arrayBuffer();
  throw new BillingUnreachable(`Kill Bill refused the account: ${response.status}`);
}

/** Creates the account and one committed invoice with one item per charter line. */
export async function invoiceCharter(options: {
  readonly charterId: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly currency: string;
  readonly charges: readonly InvoiceCharge[];
}): Promise<string> {
  const accountId = await createAccount({
    externalKey: `tidewright-${options.charterId}`,
    name: options.clientName,
    email: options.clientEmail,
    currency: options.currency,
  });
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    options.charges.map((charge) => ({
      accountId,
      amount: Number(charge.amount),
      currency: options.currency,
      description: charge.description,
    })),
  );
  if (!response.ok) {
    await response.arrayBuffer();
    throw new BillingUnreachable(`Kill Bill refused the invoice: ${response.status}`);
  }
  const items = (await response.json()) as readonly { invoiceId?: string }[];
  const invoiceId = items.find((item) => typeof item.invoiceId === 'string')?.invoiceId;
  if (invoiceId === undefined) throw new BillingUnreachable('Kill Bill returned no invoice');
  return invoiceId;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`);
  await response.arrayBuffer();
}
