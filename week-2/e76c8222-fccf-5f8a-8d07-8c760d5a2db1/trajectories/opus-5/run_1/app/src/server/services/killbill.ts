import { formatCents } from '../../shared/money';
import { InvoiceRecord } from '../../shared/types';
import { Db, query, queryOne } from '../db/pool';
import { config } from '../env';
import { ApiError } from '../http/errors';

const BILLING_TIMEOUT_MS = 4000;
const CREATED_BY = 'seatweaver';

const unavailable = (): ApiError => new ApiError('billing_unavailable');

interface KillBillAccount {
  accountId: string;
  externalKey: string;
}

interface KillBillItem {
  invoiceItemId: string;
  invoiceId: string;
  description: string | null;
  amount: number;
}

interface KillBillInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items: KillBillItem[] | null;
}

/** Kill Bill reports money as JSON numbers; they are converted once into integer cents. */
function centsOf(amount: number): number {
  return Math.round(amount * 100);
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

interface KillBillResponse {
  status: number;
  text: string;
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<KillBillResponse> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BILLING_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

function parse<T>(response: KillBillResponse): T {
  if (response.status >= 500) throw unavailable();
  return JSON.parse(response.text) as T;
}

export const accountExternalKey = (orgId: string): string => `fernhollow-${orgId}`;

export const timesheetChargeKey = (timesheetId: string): string => `ts-${timesheetId}`;

export const cancellationChargeKey = (requestId: string): string => `cx-${requestId}`;

async function findAccount(orgId: string): Promise<KillBillAccount | null> {
  const response = await call(
    'GET',
    `/accounts?externalKey=${encodeURIComponent(accountExternalKey(orgId))}`,
  );
  if (response.status === 404) return null;
  if (response.status !== 200) throw unavailable();
  return parse<KillBillAccount>(response);
}

/** One account per requester organisation, created on demand and never duplicated. */
export async function ensureAccount(db: Db, orgId: string, orgName: string): Promise<string> {
  const cached = await queryOne<{ killbill_account_id: string | null }>(
    db,
    'select killbill_account_id from orgs where id = $1',
    [orgId],
  );
  if (cached?.killbill_account_id) return cached.killbill_account_id;

  const existing = await findAccount(orgId);
  let accountId = existing?.accountId ?? null;
  if (!accountId) {
    const created = await call('POST', '/accounts', {
      externalKey: accountExternalKey(orgId),
      name: orgName,
      currency: 'USD',
    });
    if (created.status === 201) {
      const found = await findAccount(orgId);
      accountId = found?.accountId ?? null;
    } else if (created.status === 409) {
      const found = await findAccount(orgId);
      accountId = found?.accountId ?? null;
    } else {
      throw unavailable();
    }
  }
  if (!accountId) throw unavailable();
  await db.query('update orgs set killbill_account_id = $2 where id = $1', [orgId, accountId]);
  return accountId;
}

async function accountInvoices(accountId: string): Promise<KillBillInvoice[]> {
  const response = await call(
    'GET',
    `/accounts/${accountId}/invoices?withItems=true&includeInvoiceComponents=true`,
  );
  if (response.status !== 200) throw unavailable();
  return parse<KillBillInvoice[]>(response);
}

export interface ChargeItem {
  invoiceId: string;
  description: string;
  amountCents: number;
}

/** The single item holding a charge key, so a retry adopts it instead of posting twice. */
export async function findChargeByKey(
  accountId: string,
  chargeKey: string,
): Promise<ChargeItem | null> {
  const invoices = await accountInvoices(accountId);
  const prefix = `[${chargeKey}]`;
  for (const invoice of invoices) {
    for (const item of invoice.items ?? []) {
      if (item.description && item.description.startsWith(prefix)) {
        return {
          invoiceId: item.invoiceId,
          description: item.description,
          amountCents: centsOf(item.amount),
        };
      }
    }
  }
  return null;
}

export async function postCharge(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<ChargeItem> {
  const response = await call('POST', `/invoices/charges/${accountId}?autoCommit=true`, [
    {
      accountId,
      amount: Number(formatCents(amountCents)),
      currency: 'USD',
      description,
    },
  ]);
  if (response.status !== 200 && response.status !== 201) throw unavailable();
  const items = parse<KillBillItem[]>(response);
  const posted = items[0];
  if (!posted) throw unavailable();
  return {
    invoiceId: posted.invoiceId,
    description: posted.description ?? description,
    amountCents: centsOf(posted.amount),
  };
}

export async function listInvoices(accountId: string): Promise<InvoiceRecord[]> {
  const invoices = await accountInvoices(accountId);
  return invoices
    .slice()
    .sort((left, right) => (left.invoiceDate < right.invoiceDate ? 1 : left.invoiceDate > right.invoiceDate ? -1 : Number(right.invoiceNumber) - Number(left.invoiceNumber)))
    .map((invoice) => ({
      invoice_id: invoice.invoiceId,
      invoice_number: invoice.invoiceNumber,
      invoice_date: invoice.invoiceDate,
      amount: formatCents(centsOf(invoice.amount)),
      balance: formatCents(centsOf(invoice.balance)),
      currency: 'USD' as const,
      items: (invoice.items ?? []).map((item) => ({
        description: item.description ?? '',
        amount: formatCents(centsOf(item.amount)),
      })),
    }));
}

export async function killbillReachable(timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb/accounts/pagination?limit=1`, {
      headers: headers(),
      signal: abort.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureAllAccounts(db: Db): Promise<void> {
  const orgs = await query<{ id: string; name: string }>(
    db,
    'select id, name from orgs where killbill_account_id is null order by id',
  );
  for (const org of orgs) {
    await ensureAccount(db, org.id, org.name);
  }
}
