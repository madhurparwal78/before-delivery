/**
 * The Kill Bill client: payment accounts, purchases, refunds, push-notification
 * registration and health.
 *
 * Every credential is read from the environment and never reaches the browser.
 *
 * Kill Bill itself enforces one transaction per external key, refusing a
 * repeat with error code 7030. A retry after a timeout therefore adopts
 * whichever transaction already exists rather than making a second one.
 */

const KILLBILL_TIMEOUT_MS = 8_000;
const HEALTH_INTERVAL_MS = 5_000;

/** Kill Bill's code for a transaction external key that already exists. */
const DUPLICATE_TRANSACTION_CODE = 7030;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const config = {
  url: requireEnv('KILLBILL_URL'),
  username: requireEnv('KILLBILL_USERNAME'),
  password: requireEnv('KILLBILL_PASSWORD'),
  apiKey: requireEnv('KILLBILL_API_KEY'),
  apiSecret: requireEnv('KILLBILL_API_SECRET'),
};

export const CREATED_BY = 'ommezwaai-feeler';

let up = true;

export function killbillStatus(): 'up' | 'down' {
  return up ? 'up' : 'down';
}

/** Kill Bill could not be reached, so nothing is known about the request. */
export class KillbillUnreachable extends Error {
  constructor(message: string) {
    super(`killbill unreachable: ${message}`);
    this.name = 'KillbillUnreachable';
  }
}

/** Kill Bill answered and refused the request. */
export class KillbillRefused extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(status: number, body: string) {
    super(`killbill refused with ${status}: ${body.slice(0, 300)}`);
    this.name = 'KillbillRefused';
    this.status = status;
    this.code = readErrorCode(body);
  }

  get isDuplicateTransaction(): boolean {
    return this.code === DUPLICATE_TRANSACTION_CODE;
  }
}

function readErrorCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === 'number' ? parsed.code : null;
  } catch {
    return null;
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.apiKey,
    'X-Killbill-ApiSecret': config.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    accept: 'application/json',
    ...extra,
  };
}

interface CallResult {
  status: number;
  location: string | null;
  json: unknown;
}

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  allowNotFound?: boolean;
}): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(`${config.url}${options.path}`, {
      method: options.method,
      signal: AbortSignal.timeout(KILLBILL_TIMEOUT_MS),
      headers: options.body === undefined ? headers() : headers({ 'content-type': 'application/json' }),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    up = false;
    throw new KillbillUnreachable(error instanceof Error ? error.message : String(error));
  }

  if (response.status >= 500) {
    up = false;
    throw new KillbillUnreachable(`status ${response.status}`);
  }

  up = true;

  if (response.status === 404 && options.allowNotFound) {
    return { status: response.status, location: null, json: null };
  }
  if (!response.ok) throw new KillbillRefused(response.status, await response.text().catch(() => ''));

  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), json };
}

/** Kill Bill's `Location` for a payment carries a trailing slash. */
function idFromLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

export interface KillbillTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: number;
  currency: string;
}

export interface KillbillPayment {
  paymentId: string;
  accountId: string;
  transactions: KillbillTransaction[];
}

function readPayment(json: unknown): KillbillPayment {
  const body = json as Record<string, unknown>;
  const transactions = Array.isArray(body.transactions) ? body.transactions : [];
  return {
    paymentId: String(body.paymentId),
    accountId: String(body.accountId),
    transactions: transactions.map((raw) => {
      const t = raw as Record<string, unknown>;
      return {
        transactionId: String(t.transactionId),
        transactionExternalKey: String(t.transactionExternalKey),
        transactionType: String(t.transactionType),
        status: String(t.status),
        amount: Number(t.amount),
        currency: String(t.currency),
      };
    }),
  };
}

/** Amounts cross the wire in euros with two decimals. */
export function centsToEuros(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function eurosMatchCents(amount: number, cents: number): boolean {
  return Math.round(amount * 100) === cents;
}

/**
 * The rider's payment account, created on first use with a default
 * `__EXTERNAL_PAYMENT__` payment method.
 */
export async function createAccount(userId: string, name: string, email: string): Promise<string> {
  const externalKey = `rider-${userId}`;

  let accountId: string | null = null;
  try {
    const created = await call({
      method: 'POST',
      path: '/1.0/kb/accounts',
      body: { externalKey, name, email, currency: 'EUR' },
    });
    accountId = idFromLocation(created.location);
  } catch (error) {
    if (!(error instanceof KillbillRefused)) throw error;
    // The account already exists on this tenant; adopt it.
  }

  accountId ??= await findAccountByExternalKey(externalKey);
  if (!accountId) throw new KillbillUnreachable('account id missing from Kill Bill answer');

  await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    body: { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  });

  return accountId;
}

export async function findAccountByExternalKey(externalKey: string): Promise<string | null> {
  const found = await call({
    method: 'GET',
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    allowNotFound: true,
  });
  const accountId = (found.json as Record<string, unknown> | null)?.accountId;
  return accountId ? String(accountId) : null;
}

/** A payment this shop named, found by the external key it chose. */
export async function getPaymentByExternalKey(externalKey: string): Promise<KillbillPayment | null> {
  const found = await call({
    method: 'GET',
    path: `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`,
    allowNotFound: true,
  });
  return found.json === null ? null : readPayment(found.json);
}

export async function getPayment(paymentId: string): Promise<KillbillPayment | null> {
  const found = await call({
    method: 'GET',
    path: `/1.0/kb/payments/${encodeURIComponent(paymentId)}?withPluginInfo=false&withAttempts=false`,
    allowNotFound: true,
  });
  return found.json === null ? null : readPayment(found.json);
}

/**
 * One PURCHASE per attempt. The attempt's external key names both the payment
 * and the transaction, so a retry after a timeout adopts the same transaction.
 */
export async function purchase(
  accountId: string,
  amountCents: number,
  externalKey: string,
): Promise<KillbillPayment> {
  try {
    const created = await call({
      method: 'POST',
      path: `/1.0/kb/accounts/${accountId}/payments`,
      body: {
        transactionType: 'PURCHASE',
        amount: centsToEuros(amountCents),
        currency: 'EUR',
        transactionExternalKey: externalKey,
        paymentExternalKey: externalKey,
      },
    });
    const paymentId = idFromLocation(created.location);
    if (paymentId) {
      const payment = await getPayment(paymentId);
      if (payment) return payment;
    }
  } catch (error) {
    if (!(error instanceof KillbillRefused) || !error.isDuplicateTransaction) throw error;
  }

  const adopted = await getPaymentByExternalKey(externalKey);
  if (!adopted) throw new KillbillUnreachable('purchase made no payment this shop can read');
  return adopted;
}

/**
 * One refund per payment drawn on. A repeat with the same external key adopts
 * the existing REFUND transaction on that payment.
 */
export async function refund(
  paymentId: string,
  amountCents: number,
  externalKey: string,
): Promise<KillbillPayment> {
  try {
    await call({
      method: 'POST',
      path: `/1.0/kb/payments/${encodeURIComponent(paymentId)}/refunds`,
      body: { amount: centsToEuros(amountCents), currency: 'EUR', transactionExternalKey: externalKey },
    });
  } catch (error) {
    if (!(error instanceof KillbillRefused) || !error.isDuplicateTransaction) throw error;
  }

  const payment = await getPayment(paymentId);
  if (!payment) throw new KillbillUnreachable('refund made no transaction this shop can read');
  return payment;
}

/** `SUCCESS` confirms. */
export function isSuccess(status: string): boolean {
  return status === 'SUCCESS';
}

/** `PENDING` and `UNKNOWN` change nothing. */
export function isUndecided(status: string): boolean {
  return status === 'PENDING' || status === 'UNKNOWN';
}

export function isFailure(status: string): boolean {
  return !isSuccess(status) && !isUndecided(status);
}

/**
 * Register this instance's callback URL on the tenant, leaving any other
 * instance's callback in place.
 *
 * Kill Bill stores one value and a POST replaces it, so the whole set has to
 * go back as a comma-separated list. Writing only this instance's URL would
 * silently unregister every other instance on the tenant.
 */
export async function registerCallback(url: string): Promise<void> {
  const current = await call({
    method: 'GET',
    path: '/1.0/kb/tenants/registerNotificationCallback',
    allowNotFound: true,
  });
  const stored = ((current.json as Record<string, unknown> | null)?.values ?? []) as unknown[];
  const registered = stored
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (registered.includes(url)) return;

  const union = [...registered, url].join(',');
  await call({
    method: 'POST',
    path: `/1.0/kb/tenants/registerNotificationCallback?cb=${encodeURIComponent(union)}`,
  });
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${config.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(KILLBILL_TIMEOUT_MS),
    });
    up = response.status < 500;
  } catch {
    up = false;
  }
  return up;
}

export function startKillbillHealthProbe(): void {
  void health();
  setInterval(() => void health(), HEALTH_INTERVAL_MS).unref();
}
