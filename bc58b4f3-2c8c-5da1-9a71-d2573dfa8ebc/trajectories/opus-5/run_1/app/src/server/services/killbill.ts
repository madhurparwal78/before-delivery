import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { dollarAmountLiteral } from '../../shared/money.js';
import type { BillableKind } from '../domain/types.js';

export class KillBillUnreachable extends Error {
  constructor(cause: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'KillBillUnreachable';
    this.cause = cause;
  }
}

const REQUEST_TIMEOUT_MS = 20000;

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
    'X-Killbill-CreatedBy': 'teamseat',
  };
}

async function call(path: string, init: { method: string; body?: string }): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url.replace(/\/$/, '')}${path}`, {
      method: init.method,
      headers: headers(),
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new KillBillUnreachable(error);
  }
  if (response.status >= 500) {
    throw new KillBillUnreachable(new Error(`Kill Bill answered ${response.status}`));
  }
  return response;
}

export function externalKeyFor(orgCode: string): string {
  return `teamseat-${orgCode}`;
}

async function accountIdFor(orgCode: string, orgName: string): Promise<string> {
  const cached = await queryOne<{ killbill_account_id: string | null }>(
    'select killbill_account_id from orgs where code = $1',
    [orgCode],
  );
  if (cached?.killbill_account_id != null) return cached.killbill_account_id;

  const externalKey = externalKeyFor(orgCode);
  const lookup = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, {
    method: 'GET',
  });
  let accountId: string | null = null;
  if (lookup.ok) {
    const account = (await lookup.json()) as { accountId?: string };
    accountId = account.accountId ?? null;
  } else if (lookup.status !== 404) {
    throw new KillBillUnreachable(new Error(`Account lookup answered ${lookup.status}`));
  }
  if (accountId === null) {
    const created = await call('/1.0/kb/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: orgName, externalKey, currency: 'USD' }),
    });
    const location = created.headers.get('location');
    accountId = location?.split('/').pop() ?? null;
    if (accountId === null) throw new KillBillUnreachable(new Error('No account id returned'));
  }
  await query('update orgs set killbill_account_id = $1 where code = $2', [accountId, orgCode]);
  return accountId;
}

export function chargeDescription(number: string, kind: BillableKind): string {
  return `${number} ${kind === 'service' ? 'service' : 'late cancellation'}`;
}

/**
 * Posts the one external charge for an assignment and returns its invoice id.
 * Callers hold the assignment row while they call this, and store the returned
 * id in the same transaction, so an assignment is charged once.
 */
export async function postExternalCharge(input: {
  orgCode: string;
  orgName: string;
  number: string;
  kind: BillableKind;
  totalCents: number;
}): Promise<string> {
  const accountId = await accountIdFor(input.orgCode, input.orgName);
  const description = chargeDescription(input.number, input.kind);
  const body =
    `[{"accountId":"${accountId}","amount":${dollarAmountLiteral(input.totalCents)},` +
    `"currency":"USD","description":${JSON.stringify(description)}}]`;
  const response = await call(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    method: 'POST',
    body,
  });
  if (!response.ok) {
    throw new KillBillUnreachable(new Error(`Charge answered ${response.status}`));
  }
  const items = (await response.json()) as { invoiceId?: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) {
    throw new KillBillUnreachable(new Error('No invoice id returned'));
  }
  return invoiceId;
}
