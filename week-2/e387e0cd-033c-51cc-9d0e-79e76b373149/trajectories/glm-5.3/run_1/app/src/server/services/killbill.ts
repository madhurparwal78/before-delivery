import { config } from '../config.js';

// Kill Bill REST client: account per workspace (external key
// lanternline-<slug>), one external-charge invoice per month close.
export interface InvoiceItemInput { description: string; amountCents: bigint; currency: string }
export interface CreatedInvoice { invoiceId: string }

function centsToAmount(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  const digits = abs.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

async function kbRequest(method: string, path: string, body?: unknown, query?: string): Promise<{ status: number; json: unknown; location: string | null }> {
  const url = new URL(`${config.killbill.url}/1.0/kb${path}${query !== undefined ? `?${query}` : ''}`);
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'lanternline-desk',
  };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? (await import('node:https')) : (await import('node:http'));
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), method, path: `${url.pathname}${url.search}`, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, location: res.headers.location ?? null });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export async function ensureAccount(slug: string, legalName: string, currency: string): Promise<string | null> {
  const lookup = await kbRequest('GET', '/accounts', undefined, `externalKey=lanternline-${encodeURIComponent(slug)}`);
  const accounts = lookup.status === 200 && Array.isArray(lookup.json) ? (lookup.json as { accountId: string }[]) : [];
  if (accounts.length > 0) return accounts[0].accountId;
  const created = await kbRequest('POST', '/accounts', { externalKey: `lanternline-${slug}`, name: legalName, currency });
  if ((created.status === 201 || created.status === 200) && created.location !== null) {
    const id = created.location.split('/').pop();
    if (id !== undefined) return id;
  }
  const retry = await kbRequest('GET', '/accounts', undefined, `externalKey=lanternline-${encodeURIComponent(slug)}`);
  const accounts2 = retry.status === 200 && Array.isArray(retry.json) ? (retry.json as { accountId: string }[]) : [];
  return accounts2.length > 0 ? accounts2[0].accountId : null;
}

export async function createInvoice(accountId: string, items: InvoiceItemInput[]): Promise<CreatedInvoice | null> {
  const payload = items.map((item) => ({ description: item.description, amount: Number(centsToAmount(item.amountCents)), currency: item.currency }));
  const r = await kbRequest('POST', `/invoices/charges/${accountId}`, payload, 'autoCommit=true');
  if (r.status !== 200 && r.status !== 201) return null;
  const rows = Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : [];
  const invoiceId = rows.length > 0 && typeof rows[0].invoiceId === 'string' ? rows[0].invoiceId : null;
  if (invoiceId === null) return null;
  const check = await kbRequest('GET', `/invoices/${invoiceId}`);
  if (check.status !== 200) return null;
  const inv = check.json as { items?: unknown[] } | null;
  if (inv === null || !Array.isArray(inv.items) || inv.items.length !== items.length) return null;
  return { invoiceId };
}

export async function getInvoice(invoiceId: string): Promise<Record<string, unknown> | null> {
  const r = await kbRequest('GET', `/invoices/${invoiceId}`);
  return r.status === 200 ? (r.json as Record<string, unknown>) : null;
}
