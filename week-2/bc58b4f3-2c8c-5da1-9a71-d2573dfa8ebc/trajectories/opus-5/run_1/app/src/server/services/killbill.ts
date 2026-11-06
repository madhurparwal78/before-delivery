import { config } from '../config.js';
import { pool } from '../db/pool.js';

export class KillBillUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'KillBillUnavailableError';
    this.cause = cause;
  }
}

const CREATED_BY = 'teamseat';

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killBill.apiKey,
    'x-killbill-apisecret': config.killBill.apiSecret,
    'x-killbill-createdby': CREATED_BY,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${config.killBill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new KillBillUnavailableError(error);
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.status >= 500) {
    throw new KillBillUnavailableError(new Error(`${what} answered ${response.status}`));
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`${what} answered ${response.status}: ${await response.text()}`);
  }
  return response;
}

interface KillBillAccount {
  accountId: string;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await expectOk(
    await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`),
    'account lookup',
  );
  if (response.status === 404) {
    return null;
  }
  const account = (await response.json()) as KillBillAccount;
  return account.accountId;
}

/** One Kill Bill account per client organisation, created the first time it is needed. */
export async function ensureAccount(orgId: number, orgCode: string, orgName: string): Promise<string> {
  const stored = await pool.query<{ killbill_account_id: string | null }>(
    'SELECT killbill_account_id FROM orgs WHERE id = $1',
    [orgId],
  );
  const existing = stored.rows[0]?.killbill_account_id;
  if (existing !== null && existing !== undefined) {
    return existing;
  }

  const externalKey = `teamseat-${orgCode}`;
  let accountId = await findAccount(externalKey);
  if (accountId === null) {
    const created = await expectOk(
      await call('POST', '/1.0/kb/accounts', { name: orgName, externalKey, currency: 'USD' }),
      'account creation',
    );
    const location = created.headers.get('location');
    accountId =
      location === null ? await findAccount(externalKey) : (location.split('/').pop() ?? null);
    if (accountId === null) {
      throw new Error('Kill Bill did not return an account id');
    }
  }
  await pool.query('UPDATE orgs SET killbill_account_id = $1 WHERE id = $2', [accountId, orgId]);
  return accountId;
}

interface KillBillInvoiceItem {
  invoiceId: string;
  description: string;
}

export async function createExternalCharge(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<string> {
  const response = await expectOk(
    await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
      {
        accountId,
        amount: centsToAmount(amountCents),
        currency: 'USD',
        description,
      },
    ]),
    'external charge',
  );
  const items = (await response.json()) as KillBillInvoiceItem[];
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) {
    throw new Error('Kill Bill did not return an invoice id');
  }
  return invoiceId;
}

/** Decimal text for Kill Bill, derived from integer cents without floating-point arithmetic. */
function centsToAmount(cents: number): number {
  return Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
}

interface KillBillInvoiceSummary {
  invoiceId: string;
}

interface KillBillInvoiceDetail {
  invoiceId: string;
  items: KillBillInvoiceItem[];
}

/** Finds a charge this app may have created before an interruption, so none is ever duplicated. */
export async function findChargeInvoiceId(
  accountId: string,
  description: string,
): Promise<string | null> {
  const listed = await expectOk(
    await call('GET', `/1.0/kb/accounts/${accountId}/invoices`),
    'invoice list',
  );
  if (listed.status === 404) {
    return null;
  }
  const summaries = (await listed.json()) as KillBillInvoiceSummary[];
  for (const summary of summaries) {
    const detailResponse = await expectOk(
      await call('GET', `/1.0/kb/invoices/${summary.invoiceId}?withItems=true`),
      'invoice detail',
    );
    if (detailResponse.status === 404) {
      continue;
    }
    const detail = (await detailResponse.json()) as KillBillInvoiceDetail;
    if (detail.items.some((item) => item.description === description)) {
      return detail.invoiceId;
    }
  }
  return null;
}
