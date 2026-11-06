import { config } from '../config';
import { centsToPlainDecimal } from '../../shared/decimal';

/** Kill Bill invoicing: one account per workspace, one invoice per month close. */

export class InvoicingUnreachable extends Error {}

export interface InvoiceCharge {
  readonly description: string;
  readonly amountCents: bigint;
}

function headers(): Record<string, string> {
  const settings = config().killbill;
  return {
    Authorization: `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': settings.apiKey,
    'X-Killbill-ApiSecret': settings.apiSecret,
    'X-Killbill-CreatedBy': 'lanternline',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(
  method: string,
  path: string,
  body: unknown,
  rawBody?: string,
): Promise<{ status: number; text: string; location: string | null }> {
  const settings = config().killbill;
  let response: Response;
  try {
    response = await fetch(`${settings.url}${path}`, {
      method,
      headers: headers(),
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new InvoicingUnreachable('Kill Bill is unreachable');
  }
  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location'),
  };
}

export async function ensureTenant(): Promise<void> {
  const settings = config().killbill;
  const existing = await call('GET', '/1.0/kb/tenants?apiKey=' + encodeURIComponent(settings.apiKey), undefined);
  if (existing.status === 200 && existing.text.trim() !== '') return;
  await call('POST', '/1.0/kb/tenants', {
    apiKey: settings.apiKey,
    apiSecret: settings.apiSecret,
    externalKey: settings.apiKey,
  });
}

interface AccountBody {
  accountId?: string;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const found = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    undefined,
  );
  if (found.status !== 200 || found.text.trim() === '') return null;
  const parsed = JSON.parse(found.text) as AccountBody;
  return parsed.accountId ?? null;
}

async function ensureAccount(externalKey: string, name: string, currency: string): Promise<string> {
  const existing = await findAccount(externalKey);
  if (existing !== null) return existing;
  const created = await call('POST', '/1.0/kb/accounts', { externalKey, name, currency });
  if (created.status === 201 && created.location !== null) {
    const parts = created.location.split('/');
    const last = parts[parts.length - 1];
    if (last !== '') return last;
  }
  const again = await findAccount(externalKey);
  if (again === null) throw new InvoicingUnreachable('The Kill Bill account could not be created');
  return again;
}

interface ChargeResult {
  invoiceId?: string;
}

/** Posts the month's fee lines as external charges in one committed invoice. */
export async function createMonthInvoice(
  workspaceSlug: string,
  legalName: string,
  currency: string,
  charges: readonly InvoiceCharge[],
): Promise<string> {
  const accountId = await ensureAccount(`lanternline-${workspaceSlug}`, legalName, currency);
  // The amounts are written straight into the JSON so that no money value is
  // ever carried by a binary floating point number.
  const rawBody = `[${charges
    .map(
      (charge) =>
        `{"accountId":${JSON.stringify(accountId)},"amount":${centsToPlainDecimal(charge.amountCents)},"currency":${JSON.stringify(currency)},"description":${JSON.stringify(charge.description)}}`,
    )
    .join(',')}]`;
  const created = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    undefined,
    rawBody,
  );
  if (created.status >= 300 || created.text.trim() === '') {
    throw new InvoicingUnreachable(`Kill Bill answered ${created.status}`);
  }
  const parsed = JSON.parse(created.text) as ChargeResult[] | ChargeResult;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const invoiceId = items.map((item) => item.invoiceId).find((value) => value !== undefined);
  if (invoiceId === undefined) throw new InvoicingUnreachable('Kill Bill returned no invoice id');
  return invoiceId;
}
