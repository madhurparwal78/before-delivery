import { config } from '../config.js';

// Kill Bill REST client. The root is /1.0/kb under KILLBILL_URL with basic
// auth, tenant headers and the X-Killbill-CreatedBy header on writes.

export class KillBillError extends Error {
  readonly kind: 'unavailable' | 'unexpected';
  constructor(kind: 'unavailable' | 'unexpected', message: string) {
    super(message);
    this.kind = kind;
  }
}

const TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;

interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  itemType?: string;
  description?: string;
  amount?: number;
  itemAmount?: number;
}

interface KbInvoice {
  invoiceId: string;
  invoiceNumber: number;
  invoiceDate: string;
  status: string;
  amount: number;
  balance: number;
  currency: string;
  items: KbInvoiceItem[];
}

export interface KillBillInvoiceItem {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: string;
  balance: string;
  currency: string;
  items: Array<{ description: string; amount: string }>;
}

export interface ExistingCharge {
  description: string;
  amount: number; // dollars
  invoiceId: string;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'seatweaver',
    'Content-Type': 'application/json',
  };
}

async function kbFetch<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<{ status: number; body: T | null; raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
    const raw = await res.text();
    let body: T | null = null;
    if (raw) {
      try { body = JSON.parse(raw) as T; } catch { body = null; }
    }
    return { status: res.status, body, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new KillBillError('unavailable', `Kill Bill is unreachable: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function unavailableOrThrow<T>(result: { status: number; body: T | null; raw: string }): { status: number; body: T | null; raw: string } {
  if (result.status === 503) {
    throw new KillBillError('unavailable', 'Kill Bill is unavailable');
  }
  return result;
}

export async function findAccountIdByExternalKey(externalKey: string): Promise<string | null> {
  const res = unavailableOrThrow(await kbFetch<{ accountId?: string }>(`/accounts?externalKey=${encodeURIComponent(externalKey)}`));
  if (res.status === 404) return null;
  if (res.status !== 200) throw new KillBillError('unexpected', `Kill Bill account lookup failed (${res.status})`);
  return res.body?.accountId ?? null;
}

export async function ensureAccount(externalKey: string, name: string): Promise<string> {
  const existing = await findAccountIdByExternalKey(externalKey);
  if (existing) return existing;
  const created = unavailableOrThrow(await kbFetch<{ accountId?: string }>('/accounts', {
    method: 'POST',
    body: JSON.stringify({ name, externalKey, currency: 'USD' }),
  }));
  if (created.status === 201 && created.body?.accountId) return created.body.accountId;
  // Another instance may have created the same account meanwhile.
  const again = await findAccountIdByExternalKey(externalKey);
  if (again) return again;
  throw new KillBillError('unexpected', `Could not create Kill Bill account (${created.status})`);
}

// External charges are posted and committed on a new invoice right away.
export async function postExternalCharge(
  accountId: string,
  chargeKey: string,
  description: string,
  amountCents: number,
): Promise<{ invoiceId: string; amountCents: number }> {
  const items = [{ amount: amountCents / 100, currency: 'USD', description: `[${chargeKey}] ${description}` }];
  const res = unavailableOrThrow(await kbFetch<KbInvoiceItem[]>(`/invoices/charges/${accountId}?autoCommit=true`, {
    method: 'POST',
    body: JSON.stringify(items),
  }));
  if (res.status !== 200 || !res.body || res.body.length === 0 || !res.body[0]?.invoiceId) {
    throw new KillBillError('unexpected', `Kill Bill charge failed (${res.status})`);
  }
  return { invoiceId: res.body[0].invoiceId, amountCents };
}

export async function listInvoices(accountId: string): Promise<KillBillInvoiceItem[]> {
  const summary = unavailableOrThrow(await kbFetch<KbInvoice[]>(`/accounts/${accountId}/invoices`));
  if (summary.status !== 200 || !Array.isArray(summary.body)) {
    throw new KillBillError('unexpected', `Kill Bill invoice read failed (${summary.status})`);
  }
  const out: KillBillInvoiceItem[] = [];
  for (const inv of summary.body) {
    const full = unavailableOrThrow(await kbFetch<KbInvoice>(`/invoices/${inv.invoiceId}?withItems=true`));
    if (full.status !== 200 || !full.body) continue;
    const f = full.body;
    const items = (f.items ?? [])
      .filter((it) => it.itemType === 'EXTERNAL_CHARGE')
      .map((it) => ({
        description: it.description ?? '',
        amount: toMoney(it.amount ?? 0),
      }));
    out.push({
      invoice_id: f.invoiceId,
      invoice_number: String(f.invoiceNumber),
      invoice_date: f.invoiceDate,
      amount: toMoney(f.amount),
      balance: toMoney(f.balance),
      currency: f.currency ?? 'USD',
      items,
    });
  }
  out.sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : a.invoice_date === b.invoice_date ? 0 : -1));
  return out;
}

function toMoney(dollars: number): string {
  return dollars.toFixed(2);
}

// Scan the account's invoices for an item whose description starts with the charge key.
export async function findChargeByKey(accountId: string, chargeKey: string): Promise<ExistingCharge | null> {
  const invoices = await listInvoices(accountId);
  for (const inv of invoices) {
    for (const item of inv.items) {
      if (item.description.startsWith(`[${chargeKey}]`)) {
        return {
          description: item.description,
          amount: Number(item.amount),
          invoiceId: inv.invoice_id,
        };
      }
    }
  }
  return null;
}

export function sumInvoiceAmounts(invoices: KillBillInvoiceItem[]): string {
  const cents = invoices.reduce((sum, inv) => sum + Math.round(Number(inv.amount) * 100), 0);
  return (cents / 100).toFixed(2);
}

// Any HTTP answer means Kill Bill is up; only connection failures mean it is down.
export async function probeKillBill(): Promise<boolean> {
  try {
    const res = await fetch(`${config.killbill.url}/1.0/kb/tenants`, {
      headers: headers(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}
