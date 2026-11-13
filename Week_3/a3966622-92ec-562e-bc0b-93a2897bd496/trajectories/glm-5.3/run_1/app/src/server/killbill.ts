// Kill Bill client. Each agency has one account with externalKey its agency
// code, name its agency name, and currency CAD. Charges post as one DRAFT
// invoice with one EXTERNAL_CHARGE item per line; issuing commits it.

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  balance: number | null;
  amount: number;
  status: string;
  items: { amount: number; description: string | null }[];
}

export class KillBillClient {
  constructor(private readonly config: KillBillConfig) {}

  private headers(): Record<string, string> {
    const { username, password, apiKey, apiSecret } = this.config;
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'X-Killbill-ApiKey': apiKey,
      'X-Killbill-ApiSecret': apiSecret,
      'X-Killbill-CreatedBy': 'slackwater',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async accountByExternalKey(externalKey: string): Promise<{ accountId: string } | null> {
    const r = await this.request(
      `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}?limit=1`,
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new KbError(`account search failed: ${r.status}`);
    const rows = JSON.parse(r.body) as { accountId: string }[];
    if (rows.length === 0) return null;
    return { accountId: rows[0]!.accountId };
  }

  // Looks the account up by externalKey and reuses it if it exists; creates it
  // only if none exists.
  async ensureAccount(externalKey: string, name: string): Promise<string> {
    const existing = await this.accountByExternalKey(externalKey);
    if (existing) return existing.accountId;
    const r = await this.request('/1.0/kb/accounts', {
      method: 'POST',
      body: JSON.stringify({ externalKey, name, currency: 'CAD' }),
    });
    if (r.status === 201) {
      const location = r.headers.get('Location');
      const id = location ? location.split('/').pop() : null;
      if (id) return id;
    }
    if (r.ok) {
      const created = JSON.parse(r.body) as { accountId: string };
      return created.accountId;
    }
    // Race with another instance that created it concurrently.
    const again = await this.accountByExternalKey(externalKey);
    if (again) return again.accountId;
    throw new KbError(`account create failed: ${r.status}`);
  }

  // Posts lines as one DRAFT invoice, one EXTERNAL_CHARGE item per line.
  // Returns the invoice id and the item descriptions for adoption checks.
  async postExternalCharges(
    accountId: string,
    items: { amount_cents: number; description: string }[],
  ): Promise<{ invoiceId: string }> {
    const body = JSON.stringify(
      items.map((item) => ({
        accountId,
        amount: item.amount_cents / 100,
        currency: 'CAD',
        description: item.description,
        itemType: 'EXTERNAL_CHARGE',
      })),
    );
    const r = await this.request(
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
      { method: 'POST', body },
    );
    if (r.status === 200 || r.status === 201) {
      const rows = JSON.parse(r.body) as { invoiceId: string }[];
      if (rows.length === 0) throw new KbError('no items returned');
      return { invoiceId: rows[0]!.invoiceId };
    }
    throw new KbError(`charge post failed: ${r.status}`);
  }

  async invoice(invoiceId: string): Promise<KbInvoice | null> {
    const r = await this.request(`/1.0/kb/invoices/${invoiceId}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new KbError(`invoice read failed: ${r.status}`);
    const raw = JSON.parse(r.body) as {
      invoiceId: string; invoiceNumber: string; balance: number; amount: number; status: string;
      items: { amount: number; description: string | null }[];
    };
    return {
      invoiceId: raw.invoiceId,
      invoiceNumber: raw.invoiceNumber,
      balance: raw.balance,
      amount: raw.amount,
      status: raw.status,
      items: raw.items.map((i) => ({ amount: i.amount, description: i.description })),
    };
  }

  async accountInvoices(accountId: string): Promise<KbInvoice[]> {
    const r = await this.request(`/1.0/kb/accounts/${accountId}/invoices?limit=100`);
    if (!r.ok) throw new KbError(`account invoices read failed: ${r.status}`);
    const rows = JSON.parse(r.body) as {
      invoiceId: string; invoiceNumber: string; balance: number; amount: number; status: string;
      items: { amount: number; description: string | null }[];
    }[];
    return rows.map((raw) => ({
      invoiceId: raw.invoiceId,
      invoiceNumber: raw.invoiceNumber,
      balance: raw.balance,
      amount: raw.amount,
      status: raw.status,
      items: raw.items.map((i) => ({ amount: i.amount, description: i.description })),
    }));
  }

  async commitInvoice(invoiceId: string): Promise<KbInvoice> {
    const r = await this.request(`/1.0/kb/invoices/${invoiceId}/commitInvoice`, {
      method: 'PUT',
      body: '{}',
    });
    if (r.status === 204 || r.ok) {
      const inv = await this.invoice(invoiceId);
      if (inv) return inv;
    }
    throw new KbError(`invoice commit failed: ${r.status}`);
  }

  async reachable(): Promise<boolean> {
    try {
      const r = await this.request('/1.0/kb/catalog?limit=1', { timeoutMs: 4000 });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async request(
    path: string,
    opts: { method?: string; body?: string; timeoutMs?: number } = {},
  ): Promise<{ status: number; ok: boolean; body: string; headers: Headers }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.config.url}${path}`, {
        method: opts.method ?? 'GET',
        headers: this.headers(),
        body: opts.body ?? null,
        signal: controller.signal,
      });
      const body = await res.text();
      return { status: res.status, ok: res.ok, body, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class KbError extends Error {}
