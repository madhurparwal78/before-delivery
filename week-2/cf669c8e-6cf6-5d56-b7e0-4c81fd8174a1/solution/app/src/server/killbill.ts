/** Kill Bill: payment accounts, purchases, refunds, the notification callback and the health probe. */
import { randomBytes } from 'node:crypto';
import { callbackOrigin, config } from './config.js';
import { one, query, sql, theRow, type Db } from './db.js';
import { isRecord } from './errors.js';
import { readHealth, recordHealth } from './health.js';

export class KillBillUnreachable extends Error {}

interface Answer { status: number; json: unknown; location: string | null }

const authorization = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`;

async function call(method: string, path: string, body?: unknown, timeoutMs = 10000, tolerate5xx = false): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: authorization,
        'X-Killbill-ApiKey': config.killbill.apiKey,
        'X-Killbill-ApiSecret': config.killbill.apiSecret,
        'X-Killbill-CreatedBy': 'ommezwaai-feeler',
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new KillBillUnreachable();
  }
  if (response.status >= 500 && !tolerate5xx) throw new KillBillUnreachable();
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, location: response.headers.get('location') };
}

const lastSegment = (location: string | null): string | null => location?.replace(/\/+$/, '').split('/').pop() ?? null;

const euros = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
/** Kill Bill's decimal amount as whole cents, read from its digits. */
export function centsOf(amount: unknown): number {
  const [whole = '0', fraction = ''] = String(amount).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

// ---- health -------------------------------------------------------------------------------------------------------

/**
 * Kill Bill answers 500 from its health check when a queue is growing (for example retries to a callback that is
 * down) while it still takes payments, so the core check decides, not the overall status.
 */
function coreIsHealthy(json: unknown): boolean {
  const core = isRecord(json) ? json['org.killbill.billing.server.healthchecks.KillbillHealthcheck'] : null;
  return isRecord(core) && core['healthy'] === true;
}

const PROBE_TIMEOUT_MS = 2000;
const RECHECK_MS = 500;
const PROBE_PERIOD_MS = 4500;
const SLOT_SPACING_MS = 300;

async function probeAnswers(): Promise<boolean> {
  try {
    const answer = await call('GET', '/1.0/healthcheck', undefined, PROBE_TIMEOUT_MS, true);
    return answer.status === 200 || coreIsHealthy(answer.json);
  } catch {
    return false;
  }
}

/** Down after a miss and a quick recheck both fail, so one slow answer does not pause payments. */
export async function runKillBillProbe(): Promise<void> {
  let healthy = await probeAnswers();
  if (!healthy) {
    await new Promise((resolve) => setTimeout(resolve, RECHECK_MS));
    healthy = await probeAnswers();
  }
  await recordHealth(config.killbill.url, healthy);
}

/**
 * Kill Bill's queue health check records each call in statistics that concurrent calls can corrupt, so instances on one
 * host take turns: each port probes in its own slot of the wall-clock period, within the published five seconds.
 */
export function nextKillBillProbe(): number {
  const slot = (config.port * SLOT_SPACING_MS) % PROBE_PERIOD_MS;
  const wait = ((slot - Date.now()) % PROBE_PERIOD_MS + PROBE_PERIOD_MS) % PROBE_PERIOD_MS;
  return wait || PROBE_PERIOD_MS;
}

export async function killbillStatus(): Promise<'up' | 'down'> {
  if ((await readHealth(sql, config.killbill.url)) === null) await runKillBillProbe();
  return (await readHealth(sql, config.killbill.url)) ? 'up' : 'down';
}

/** Read on the caller's own connection, so that a transaction never waits on a second one. An address not probed yet counts as up: the call itself will tell. */
export const killbillIsUp = async (db: Db): Promise<boolean> => (await readHealth(db, config.killbill.url)) !== false;

// ---- accounts, purchases, refunds -----------------------------------------------------------------------------------

export async function ensureAccount(user: { id: string; email: string; name: string }): Promise<string> {
  const known = await one<{ account_id: string }>(sql, 'SELECT account_id FROM kb_accounts WHERE user_id = $1', [user.id]);
  if (known) return known.account_id;
  const externalKey = `rider-${user.id}`;
  const created = await call('POST', '/1.0/kb/accounts', { externalKey, currency: 'EUR', email: user.email, name: user.name });
  let accountId = created.status === 201 ? lastSegment(created.location) : null;
  if (!accountId) {
    const existing = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    accountId = existing.status === 200 ? textField(existing.json, 'accountId') : null;
  }
  if (!accountId) throw new KillBillUnreachable();
  const account = await call('GET', `/1.0/kb/accounts/${accountId}`);
  if (!textField(account.json, 'paymentMethodId')) {
    await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} });
  }
  await query(sql, 'INSERT INTO kb_accounts (user_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, accountId]);
  return accountId;
}

export interface KbTransaction { transactionId: string; transactionExternalKey: string; transactionType: string; amount: unknown; currency: string; status: string }
interface KbPayment { paymentId: string; transactions: KbTransaction[] }

function textField(json: unknown, name: string): string | null {
  const value = isRecord(json) ? json[name] : null;
  return typeof value === 'string' ? value : null;
}

function paymentOf(json: unknown): KbPayment | null {
  const paymentId = textField(json, 'paymentId');
  if (!paymentId || !isRecord(json) || !Array.isArray(json['transactions'])) return null;
  const transactions = json['transactions'].filter(isRecord).map((t): KbTransaction => ({
    transactionId: textField(t, 'transactionId') ?? '', transactionExternalKey: textField(t, 'transactionExternalKey') ?? '', transactionType: textField(t, 'transactionType') ?? '',
    amount: t['amount'], currency: textField(t, 'currency') ?? '', status: textField(t, 'status') ?? '',
  }));
  return { paymentId, transactions };
}

export async function readPayment(paymentId: string): Promise<KbPayment | null> {
  const answer = await call('GET', `/1.0/kb/payments/${encodeURIComponent(paymentId)}`);
  return answer.status === 200 ? paymentOf(answer.json) : null;
}

async function findByKey(accountId: string, externalKey: string): Promise<{ payment: KbPayment; transaction: KbTransaction } | null> {
  const answer = await call('GET', `/1.0/kb/accounts/${accountId}/payments`);
  for (const listed of Array.isArray(answer.json) ? answer.json : []) {
    const payment = paymentOf(listed);
    const transaction = payment?.transactions.find((t) => t.transactionExternalKey === externalKey);
    if (payment && transaction) return { payment, transaction };
  }
  return null;
}

type Sent = { kind: 'sent'; paymentId: string; transactionId: string | null } | { kind: 'refused' };

async function sent(answer: Answer, accountId: string | null, paymentId: string | null, externalKey: string): Promise<Sent> {
  const exists = answer.status === 400 && isRecord(answer.json) && answer.json['code'] === 7030;
  if (answer.status !== 201 && !exists) return { kind: 'refused' };
  if (accountId) {
    const found = await findByKey(accountId, externalKey);
    if (found) return { kind: 'sent', paymentId: found.payment.paymentId, transactionId: found.transaction.transactionId };
  }
  if (paymentId) {
    const payment = await readPayment(paymentId);
    return { kind: 'sent', paymentId, transactionId: payment?.transactions.find((t) => t.transactionExternalKey === externalKey)?.transactionId ?? null };
  }
  return { kind: 'refused' };
}

/** One PURCHASE; a repeat of an external key that Kill Bill already holds adopts the existing transaction. */
export async function purchase(accountId: string, externalKey: string, cents: number): Promise<Sent> {
  const answer = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE', amount: euros(cents), currency: 'EUR', transactionExternalKey: externalKey,
  });
  return sent(answer, accountId, null, externalKey);
}

/** One refund on a payment; the account is needed to adopt a transaction that already exists. */
export async function refund(accountId: string, paymentId: string, externalKey: string, cents: number): Promise<Sent> {
  const answer = await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: euros(cents), currency: 'EUR', transactionExternalKey: externalKey,
  });
  return sent(answer, accountId, paymentId, externalKey);
}

// ---- the notification callback ---------------------------------------------------------------------------------------

export async function callbackSecret(): Promise<string> {
  const fresh = randomBytes(30).toString('base64url');
  await query(sql, "INSERT INTO settings (key, value) VALUES ('killbill_callback_secret', $1) ON CONFLICT DO NOTHING", [fresh]);
  return (await theRow<{ value: string }>(sql, "SELECT value FROM settings WHERE key = 'killbill_callback_secret'")).value;
}

/**
 * Make sure this instance's URL is among the tenant's callbacks. The tenant keeps them as one comma-joined value, and
 * two instances writing at once can leave it unreadable (Kill Bill answers 500): then it is cleared and rebuilt, and
 * every other instance re-adds itself when its own check finds it missing.
 */
export async function registerCallback(): Promise<void> {
  const url = `${callbackOrigin()}/api/killbill/notifications/${await callbackSecret()}`;
  const path = '/1.0/kb/tenants/registerNotificationCallback';
  const current = await call('GET', path, undefined, 10000, true);
  let values: string[] = [];
  if (current.status >= 500) await call('DELETE', path, undefined, 10000, true);
  else if (isRecord(current.json) && Array.isArray(current.json['values'])) values = current.json['values'].flatMap((v: string) => v.split(',')).filter(Boolean);
  if (values.includes(url)) return;
  await call('POST', `${path}?cb=${encodeURIComponent([...values, url].join(','))}`);
}

const CALLBACK_RECHECK_MS = 10000;
const CALLBACK_RETRY_MS = 1000;

/** Verified again every 10 seconds; until Kill Bill answers, retried about every second, with jitter so instances do not write together. */
export function nextCallbackCheck(succeeded: boolean): number {
  return succeeded ? CALLBACK_RECHECK_MS : CALLBACK_RETRY_MS + Math.random() * CALLBACK_RETRY_MS;
}
