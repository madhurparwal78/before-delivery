/** Kill Bill boundary: real HTTP calls whose answers alone decide whether a purchase is confirmed. */
import { config } from './config';

const TIMEOUT_MS = 5000;
const CREATED_BY = 'headstring';

export class PaymentsDown extends Error {}

interface KillBillAccount {
  accountId: string;
}

interface KillBillTransaction {
  transactionType: string;
  status: string;
}

interface KillBillPayment {
  paymentId: string;
  transactions: KillBillTransaction[];
}

async function call(path: string, deadline: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      signal: deadline,
      redirect: 'manual',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'X-Killbill-ApiKey': apiKey,
        'X-Killbill-ApiSecret': apiSecret,
        'X-Killbill-CreatedBy': CREATED_BY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new PaymentsDown();
  }
}

async function accountFor(playerId: string, email: string, name: string, deadline: AbortSignal): Promise<string> {
  const existing = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(playerId)}`, deadline);
  if (existing.status === 200) return ((await existing.json()) as KillBillAccount).accountId;
  if (existing.status !== 404) throw new PaymentsDown();

  const created = await call('/1.0/kb/accounts', deadline, {
    method: 'POST',
    body: JSON.stringify({ externalKey: playerId, email, name, currency: 'USD' }),
  });
  if (created.status !== 201) throw new PaymentsDown();
  const fetched = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(playerId)}`, deadline);
  if (fetched.status !== 200) throw new PaymentsDown();
  const { accountId } = (await fetched.json()) as KillBillAccount;

  const method = await call(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, deadline, {
    method: 'POST',
    body: JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__' }),
  });
  if (method.status !== 201) throw new PaymentsDown();
  return accountId;
}

/** Records one PURCHASE and returns the Kill Bill payment id once its transaction reports success. */
export async function purchase(
  order: { playerId: string; email: string; name: string; amountUsd: string; paymentKey: string },
): Promise<string> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const accountId = await accountFor(order.playerId, order.email, order.name, deadline);
  const created = await call(`/1.0/kb/accounts/${accountId}/payments`, deadline, {
    method: 'POST',
    body: JSON.stringify({ transactionType: 'PURCHASE', amount: order.amountUsd, currency: 'USD', paymentExternalKey: order.paymentKey }),
  });
  if (created.status !== 201) throw new PaymentsDown();
  const fetched = await call(`/1.0/kb/payments?externalKey=${encodeURIComponent(order.paymentKey)}`, deadline);
  if (fetched.status !== 200) throw new PaymentsDown();
  const payment = (await fetched.json()) as KillBillPayment;
  const done = payment.transactions.some(({ transactionType, status }) => transactionType === 'PURCHASE' && status === 'SUCCESS');
  if (!done) throw new PaymentsDown();
  return payment.paymentId;
}

export async function killbillReachable(): Promise<boolean> {
  try {
    await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
