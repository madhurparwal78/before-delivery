/** Kill Bill: the one stage-fee invoice raised by each sign-off. */

import { config } from '../config.js';
import { centsToDecimal } from '../../shared/format.js';
import type { Currency } from '../../shared/domain.js';
import { billingUnavailable } from '../http/errors.js';

const CREATED_BY = 'plumbline';

export interface StageInvoice {
  killbillInvoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: Currency;
}

function headers(withBody: boolean): Record<string, string> {
  const basic = Buffer.from(
    `${config.killbill.username}:${config.killbill.password}`,
  ).toString('base64');
  const base: Record<string, string> = {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': CREATED_BY,
    accept: 'application/json',
  };
  if (withBody) base['content-type'] = 'application/json';
  return base;
}

async function call(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      method: init.method,
      headers: headers(init.body !== undefined),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw billingUnavailable();
  }
}

async function accountIdFor(options: {
  externalKey: string;
  name: string;
  currency: Currency;
}): Promise<string> {
  const found = await call(
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(options.externalKey)}`,
    { method: 'GET' },
  );
  if (found.ok) {
    const account = (await found.json()) as { accountId?: string };
    if (account.accountId) return account.accountId;
  } else if (found.status !== 404) {
    throw billingUnavailable();
  }

  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: {
      externalKey: options.externalKey,
      name: options.name,
      currency: options.currency,
    },
  });
  if (created.status === 201) {
    const location = created.headers.get('location');
    const id = location?.split('/').pop();
    if (id) return id;
  }
  if (created.status === 409) {
    const again = await call(
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(options.externalKey)}`,
      { method: 'GET' },
    );
    if (again.ok) {
      const account = (await again.json()) as { accountId?: string };
      if (account.accountId) return account.accountId;
    }
  }
  throw billingUnavailable();
}

/** Raises and commits one invoice holding a single external stage-fee charge. */
export async function raiseStageInvoice(options: {
  projectReference: string;
  projectName: string;
  brandName: string;
  stageName: string;
  feeCents: number;
  currency: Currency;
}): Promise<StageInvoice> {
  const accountId = await accountIdFor({
    externalKey: `plumbline-${options.projectReference}`,
    name: `${options.brandName} - ${options.projectName}`,
    currency: options.currency,
  });

  const charged = await call(
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    {
      method: 'POST',
      body: [
        {
          accountId,
          amount: Number(centsToDecimal(options.feeCents)),
          currency: options.currency,
          description: `${options.projectReference} ${options.stageName} stage fee`,
        },
      ],
    },
  );
  if (!charged.ok) throw billingUnavailable();
  const items = (await charged.json()) as { invoiceId?: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw billingUnavailable();

  const invoice = await call(`/1.0/kb/invoices/${invoiceId}`, { method: 'GET' });
  if (!invoice.ok) throw billingUnavailable();
  const detail = (await invoice.json()) as { invoiceNumber?: string };
  if (!detail.invoiceNumber) throw billingUnavailable();

  return {
    killbillInvoiceId: invoiceId,
    invoiceNumber: String(detail.invoiceNumber),
    amountCents: options.feeCents,
    currency: options.currency,
  };
}

/** Voids an invoice raised for a sign-off that could not be recorded. */
export async function voidInvoice(invoiceId: string): Promise<void> {
  await call(`/1.0/kb/invoices/${invoiceId}`, { method: 'DELETE' }).catch(() => undefined);
}
