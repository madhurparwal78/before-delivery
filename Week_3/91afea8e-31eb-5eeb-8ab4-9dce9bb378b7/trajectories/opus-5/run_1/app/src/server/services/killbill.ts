/** Kill Bill is the payment of record: one PURCHASE per leg, one REFUND per refund. */

import { config } from '../config.js';

const TIMEOUT_MS = 5_000;
const EXTERNAL_PLUGIN = '__EXTERNAL_PAYMENT__';

type KbReply = { status: number; location: string | null; json: unknown };

async function call(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<KbReply | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  try {
    const response = await fetch(`${config.killbill.url}${path}`, {
      method: init.method,
      headers: {
        authorization: `Basic ${auth}`,
        'x-killbill-apikey': config.killbill.apiKey,
        'x-killbill-apisecret': config.killbill.apiSecret,
        'x-killbill-createdby': 'chauraha',
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    return {
      status: response.status,
      location: response.headers.get('location'),
      json: parsed,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const parts = location.split('/').filter((part) => part !== '');
  const last = parts[parts.length - 1];
  return last === undefined ? null : last;
}

function rupees(amountPaise: number): string {
  return (amountPaise / 100).toFixed(2);
}

export async function ensureShopperAccount(
  accountId: string,
  name: string,
): Promise<string | null> {
  const externalKey = `shopper-${accountId}`;
  const existing = await call(
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    { method: 'GET' },
  );
  if (existing === null) return null;
  if (existing.status === 200 && existing.json !== null) {
    const found = existing.json as { accountId?: string };
    if (typeof found.accountId === 'string') {
      await ensureDefaultPaymentMethod(found.accountId);
      return found.accountId;
    }
  }
  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: { externalKey, name, currency: 'INR' },
  });
  if (created === null) return null;
  const kbAccountId = idFromLocation(created.location);
  if (kbAccountId === null) return null;
  await ensureDefaultPaymentMethod(kbAccountId);
  return kbAccountId;
}

async function ensureDefaultPaymentMethod(kbAccountId: string): Promise<void> {
  const methods = await call(`/1.0/kb/accounts/${kbAccountId}/paymentMethods`, { method: 'GET' });
  if (methods !== null && Array.isArray(methods.json) && methods.json.length > 0) return;
  await call(`/1.0/kb/accounts/${kbAccountId}/paymentMethods?isDefault=true`, {
    method: 'POST',
    body: { pluginName: EXTERNAL_PLUGIN, pluginInfo: {} },
  });
}

/** Records one PURCHASE. Returns the Kill Bill payment id, or null while Kill Bill is away. */
export async function recordPurchase(input: {
  kbAccountId: string;
  externalKey: string;
  amountPaise: number;
}): Promise<string | null> {
  const found = await findPaymentByExternalKey(input.externalKey);
  if (found !== null) return found;
  const created = await call(`/1.0/kb/accounts/${input.kbAccountId}/payments`, {
    method: 'POST',
    body: {
      transactionType: 'PURCHASE',
      amount: rupees(input.amountPaise),
      currency: 'INR',
      paymentExternalKey: input.externalKey,
      transactionExternalKey: input.externalKey,
    },
  });
  if (created === null) return null;
  if (created.status === 409) return findPaymentByExternalKey(input.externalKey);
  if (created.status >= 300) return null;
  return idFromLocation(created.location);
}

export async function findPaymentByExternalKey(externalKey: string): Promise<string | null> {
  const reply = await call(`/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`, {
    method: 'GET',
  });
  if (reply === null || reply.status !== 200 || reply.json === null) return null;
  const payment = reply.json as { paymentId?: string };
  return typeof payment.paymentId === 'string' ? payment.paymentId : null;
}

/** Records one REFUND against a leg's payment. */
export async function recordRefund(input: {
  kbPaymentId: string;
  transactionExternalKey: string;
  amountPaise: number;
}): Promise<boolean> {
  const reply = await call(`/1.0/kb/payments/${input.kbPaymentId}/refunds`, {
    method: 'POST',
    body: {
      amount: rupees(input.amountPaise),
      currency: 'INR',
      transactionExternalKey: input.transactionExternalKey,
    },
  });
  if (reply === null) return false;
  return reply.status < 300 || reply.status === 409;
}

