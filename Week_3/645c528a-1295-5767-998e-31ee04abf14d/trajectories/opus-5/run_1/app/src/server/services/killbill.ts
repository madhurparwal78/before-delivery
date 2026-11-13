import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { ApiError } from '../errors.js';

const TIMEOUT_MS = 5000;

function headers(withBody: boolean): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  const base: Record<string, string> = {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'long-rail',
    accept: 'application/json',
  };
  if (withBody) base['content-type'] = 'application/json';
  return base;
}

function paymentsUnavailable(): ApiError {
  return new ApiError(503, 'payments_unavailable', 'Payments are down. You have not been charged.');
}

async function callKillBill(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      method: init.method,
      headers: headers(init.body !== undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw paymentsUnavailable();
  }
}

async function accountIdFor(playerId: string, email: string, displayName: string): Promise<string> {
  const stored = await queryOne<{ account_id: string }>(`SELECT account_id FROM killbill_accounts WHERE player_id = $1`, [playerId]);
  if (stored) return stored.account_id;

  const lookup = await callKillBill(`/1.0/kb/accounts?externalKey=${encodeURIComponent(playerId)}`, { method: 'GET' });
  let accountId: string | null = null;
  if (lookup.ok) {
    const body = (await lookup.json().catch(() => null)) as { accountId?: string } | null;
    accountId = body?.accountId ?? null;
  }
  if (!accountId) {
    const created = await callKillBill('/1.0/kb/accounts', {
      method: 'POST',
      body: { externalKey: playerId, name: displayName, email, currency: 'USD' },
    });
    if (!created.ok && created.status !== 409) throw paymentsUnavailable();
    const location = created.headers.get('location');
    accountId = location ? location.split('/').filter(Boolean).pop() ?? null : null;
    if (!accountId) {
      const retry = await callKillBill(`/1.0/kb/accounts?externalKey=${encodeURIComponent(playerId)}`, { method: 'GET' });
      const body = (await retry.json().catch(() => null)) as { accountId?: string } | null;
      accountId = body?.accountId ?? null;
    }
    if (!accountId) throw paymentsUnavailable();
  }
  const method = await callKillBill(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true&payAllUnpaidInvoices=false`, {
    method: 'POST',
    body: { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  });
  if (!method.ok && method.status !== 409) throw paymentsUnavailable();
  await query(`INSERT INTO killbill_accounts (player_id, account_id) VALUES ($1, $2) ON CONFLICT (player_id) DO NOTHING`, [playerId, accountId]);
  return accountId;
}

/** One PURCHASE payment on the player's account. Cash is credited only on success. */
export async function chargePack(input: {
  playerId: string;
  email: string;
  displayName: string;
  priceUsd: string;
  idempotencyKey: string;
}): Promise<string> {
  const accountId = await accountIdFor(input.playerId, input.email, input.displayName);
  const response = await callKillBill(`/1.0/kb/accounts/${accountId}/payments`, {
    method: 'POST',
    body: {
      transactionType: 'PURCHASE',
      amount: Number(input.priceUsd),
      currency: 'USD',
      transactionExternalKey: `${input.playerId}:${input.idempotencyKey}`,
    },
  });
  if (!response.ok) throw paymentsUnavailable();
  const location = response.headers.get('location');
  const paymentId = location ? location.split('/').filter(Boolean).pop() ?? null : null;
  if (!paymentId) throw paymentsUnavailable();
  const check = await callKillBill(`/1.0/kb/payments/${paymentId}`, { method: 'GET' });
  if (!check.ok) throw paymentsUnavailable();
  const payment = (await check.json().catch(() => null)) as
    | { transactions?: { transactionType?: string; status?: string }[] }
    | null;
  const success = payment?.transactions?.some(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
  if (!success) throw paymentsUnavailable();
  return paymentId;
}

export async function killbillReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}
