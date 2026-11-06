import type { Config } from './config.js';

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  description: string;
  amount: number;
  itemType: string;
  itemDetails: string | null;
  startDate: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  status: string;
  amount: number;
  items: KbInvoiceItem[];
}

/** Kill Bill client. Lineboard's Kill Bill amount ignores CBA_ADJ items. */
export class KillBillClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.config.killbillUsername}:${this.config.killbillPassword}`).toString('base64'),
      'X-Killbill-ApiKey': this.config.killbillApiKey,
      'X-Killbill-ApiSecret': this.config.killbillApiSecret,
      'X-Killbill-CreatedBy': 'lineboard',
      'Content-Type': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; location?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${this.config.killbillUrl}/1.0/kb${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json, location: response.headers.get('location') ?? undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  async reachable(): Promise<boolean> {
    try {
      const r = await this.request('GET', '/healthcheck');
      return r.status === 200 || r.status === 401 || r.status === 404;
    } catch {
      return false;
    }
  }

  async findAccountByExternalKey(externalKey: string): Promise<string | null> {
    const r = await this.request('GET', `/accounts/search/${encodeURIComponent(externalKey)}`);
    if (r.status !== 200 || !Array.isArray(r.json) || r.json.length === 0) return null;
    return (r.json as { accountId: string }[])[0].accountId;
  }

  async createAccount(externalKey: string, name: string): Promise<string> {
    const r = await this.request('POST', '/accounts', { externalKey, name, currency: 'USD' });
    if (r.location) {
      const m = /accounts\/([0-9a-f-]+)/.exec(r.location);
      if (m) return m[1];
    }
    if (r.status === 400 || r.status === 409) {
      // The account already exists (an earlier instance created it): find it
      // by its external key and reuse it.
      const existing = await this.findAccountByExternalKey(externalKey);
      if (existing) return existing;
    }
    throw new Error('Kill Bill account creation failed');
  }

  async updateAccountName(accountId: string, name: string): Promise<void> {
    await this.request('PUT', `/accounts/${accountId}`, { name, currency: 'USD' });
  }

  /** Amounts are dollars with two decimals. Kill Bill stores only BMP characters. */
  static kbSafeName(name: string): string {
    let out = '';
    for (const ch of name) {
      out += ch.codePointAt(0)! > 0xffff ? '\ufffd' : ch;
    }
    return out;
  }

  async addCharges(accountId: string, items: { description: string; amount: number; itemDetails: string }[]): Promise<KbInvoiceItem[]> {
    if (items.length === 0) return [];
    const r = await this.request('POST', `/invoices/charges/${accountId}?autoCommit=false`, items);
    if (r.status !== 200 && r.status !== 201) throw new Error('Kill Bill charge failed');
    return r.json as KbInvoiceItem[];
  }

  async addCredits(accountId: string, items: { description: string; amount: number; itemDetails: string }[]): Promise<KbInvoiceItem[]> {
    if (items.length === 0) return [];
    const r = await this.request('POST', `/credits?autoCommit=false`, items.map((i) => ({ ...i, accountId })));
    if (r.status !== 200 && r.status !== 201) throw new Error('Kill Bill credit failed');
    return r.json as KbInvoiceItem[];
  }

  async listInvoices(accountId: string): Promise<KbInvoice[]> {
    const r = await this.request('GET', `/accounts/${accountId}/invoices`);
    if (r.status !== 200 || !Array.isArray(r.json)) return [];
    const summaries = r.json as { invoiceId: string; status: string }[];
    const invoices: KbInvoice[] = [];
    for (const s of summaries) {
      const detail = await this.request('GET', `/invoices/${s.invoiceId}`);
      if (detail.status === 200 && detail.json) {
        const inv = detail.json as KbInvoice;
        invoices.push(inv);
      }
    }
    return invoices;
  }

  async commitInvoice(invoiceId: string): Promise<void> {
    const r = await this.request('PUT', `/invoices/${invoiceId}/commitInvoice`);
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw new Error('Kill Bill commit failed');
  }
}
