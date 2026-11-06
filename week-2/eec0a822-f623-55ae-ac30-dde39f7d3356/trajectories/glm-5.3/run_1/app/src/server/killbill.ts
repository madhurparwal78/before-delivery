import type { Config } from './config.js';

export interface KbLine {
  description: string;
  amountMajor: string;
}

export interface KbInvoice {
  invoiceId: string;
}

export class BillingUnavailable extends Error {}

function authHeader(config: Config): string {
  return 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
}

async function kbFetch(config: Config, path: string, init: RequestInit & { body?: string }): Promise<Response> {
  try {
    return await fetch(config.killbill.url + path, {
      ...init,
      headers: {
        Authorization: authHeader(config),
        'X-Killbill-ApiKey': config.killbill.apiKey,
        'X-Killbill-ApiSecret': config.killbill.apiSecret,
        'X-Killbill-CreatedBy': 'tidewright',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new BillingUnavailable();
  }
}

function bad(res: Response): BillingUnavailable {
  return new BillingUnavailable(`Kill Bill HTTP ${res.status}`);
}

export async function createAccountWithInvoice(
  config: Config,
  externalKey: string,
  clientName: string,
  clientEmail: string,
  currency: string,
  lines: KbLine[],
  targetDate: string,
): Promise<KbInvoice> {
  const acctRes = await kbFetch(config, '/1.0/kb/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: clientName, email: clientEmail, currency, externalKey }),
  });
  if (acctRes.status !== 201) throw bad(acctRes);
  const location = acctRes.headers.get('Location') ?? '';
  const accountId = /\/accounts\/([^/?]+)/.exec(location)?.[1] ?? '';
  if (!accountId) throw new BillingUnavailable('no account id');
  const items = lines.map((l) => ({ amount: Number(l.amountMajor), currency, description: l.description }));
  const url =
    `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}` +
    `?autoCommit=true&requestedDate=${encodeURIComponent(targetDate)}`;
  const invRes = await kbFetch(config, url, { method: 'POST', body: JSON.stringify(items) });
  if (invRes.status !== 200 && invRes.status !== 201) throw bad(invRes);
  const text = await invRes.text();
  let itemsOut: Array<{ invoiceId: string }> = [];
  try {
    itemsOut = JSON.parse(text);
  } catch {
    throw new BillingUnavailable('bad invoice response');
  }
  const invoiceId = itemsOut[0]?.invoiceId;
  if (!invoiceId) throw new BillingUnavailable('no invoice id');
  return { invoiceId };
}

export async function voidInvoice(config: Config, invoiceId: string): Promise<void> {
  try {
    await kbFetch(config, `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/voidInvoice`, { method: 'PUT' });
  } catch {
    // Best effort: the invoice is orphaned in Kill Bill; nothing is recorded locally.
  }
}
