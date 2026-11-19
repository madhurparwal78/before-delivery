import type { Env } from '../env.js';
import type { Json } from '../types.js';

/** A thin real Kill Bill client: no local stand-ins, all calls go to KILLBILL_URL. */
export class KillBillClient {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private async request<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T | null; location?: string }> {
    const base = this.env.KILLBILL_URL.replace(/\/$/, '');
    const headers: Record<string, string> = {
      Authorization:
        'Basic ' + Buffer.from(`${this.env.KILLBILL_USERNAME}:${this.env.KILLBILL_PASSWORD}`).toString('base64'),
      'X-Killbill-ApiKey': this.env.KILLBILL_API_KEY,
      'X-Killbill-ApiSecret': this.env.KILLBILL_API_SECRET,
      'X-Killbill-CreatedBy': 'pilotlight',
      ...extraHeaders,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const location = response.headers.get('Location') ?? undefined;
    const text = await response.text();
    let parsed: T | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, body: parsed, location };
  }

  /** The member's Kill Bill account, created only when the lookup finds none. */
  async ensureAccount(input: { externalKey: string; name: string; email: string }): Promise<{ accountId: string; paymentMethodId: string | null }> {
    const found = await this.request<Json & Record<string, Json>>(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.externalKey)}`,
    );
    if (found.status === 200 && found.body && typeof found.body === 'object' && 'accountId' in found.body) {
      const record = found.body as Record<string, Json>;
      return {
        accountId: String(record.accountId),
        paymentMethodId: record.paymentMethodId === null || record.paymentMethodId === undefined ? null : String(record.paymentMethodId),
      };
    }
    if (found.status !== 404) throw new Error('Kill Bill account lookup failed');
    const created = await this.request<Json & Record<string, Json>>('POST', '/1.0/kb/accounts', {
      externalKey: input.externalKey,
      name: input.name,
      email: input.email,
      currency: 'USD',
    });
    let accountId = '';
    let paymentMethodId: string | null = null;
    if ((created.status === 201 || created.status === 200) && created.body && typeof created.body === 'object' && 'accountId' in created.body) {
      const record = created.body as Record<string, Json>;
      accountId = String(record.accountId);
      paymentMethodId = record.paymentMethodId === null || record.paymentMethodId === undefined ? null : String(record.paymentMethodId);
    } else {
      const again = await this.request<Json & Record<string, Json>>(
        'GET',
        `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.externalKey)}`,
      );
      if (again.status !== 200 || !again.body || typeof again.body !== 'object' || !('accountId' in again.body)) {
        throw new Error('Kill Bill account creation failed');
      }
      const record = again.body as Record<string, Json>;
      accountId = String(record.accountId);
    }
    if (paymentMethodId === null) {
      // Kill Bill's built-in external payment method as the default, so charges can be taken.
      const method = await this.request<Json & Record<string, Json>>(
        'POST',
        `/1.0/kb/accounts/${accountId}/paymentMethods`,
        { pluginName: '__EXTERNAL_PAYMENT__', isDefault: true },
      );
      if ((method.status === 201 || method.status === 200) && method.body && typeof method.body === 'object' && 'paymentMethodId' in method.body) {
        const record = method.body as Record<string, Json>;
        paymentMethodId = String(record.paymentMethodId);
      } else if (method.location !== undefined) {
        const tail = method.location.split('/').filter(Boolean).pop() ?? '';
        paymentMethodId = tail.replace(/\/$/, '') || null;
      }
    }
    return { accountId, paymentMethodId };
  }

  /** One PURCHASE payment for a pack, keyed by the purchase id. */
  async createPackPayment(input: {
    accountId: string;
    paymentMethodId: string | null;
    transactionExternalKey: string;
    amountDollars: number;
  }): Promise<{ paymentId: string }> {
    const methodQuery = input.paymentMethodId === null ? '' : `?paymentMethodId=${input.paymentMethodId}`;
    const result = await this.request<Json & Record<string, Json>>(
      'POST',
      `/1.0/kb/accounts/${input.accountId}/payments${methodQuery}`,
      {
        transactionType: 'PURCHASE',
        amount: input.amountDollars,
        currency: 'USD',
        transactionExternalKey: input.transactionExternalKey,
      },
      { 'X-Killbill-Transaction-External-Key': input.transactionExternalKey },
    );
    if (result.status >= 200 && result.status < 300) {
      const location = result.location ?? '';
      const fromLocation = location.split('/').filter(Boolean).pop();
      if (result.body && typeof result.body === 'object' && 'paymentId' in result.body) {
        return { paymentId: String((result.body as Record<string, Json>).paymentId) };
      }
      if (typeof fromLocation === 'string' && fromLocation !== '') {
        return { paymentId: fromLocation };
      }
    }
    throw new Error('Kill Bill payment failed');
  }

  /** A draft external-charge invoice for an overage, ready to be committed. */
  async createOverageInvoice(input: {
    accountId: string;
    amountDollars: number;
    description: string;
    externalKey: string;
  }): Promise<string> {
    const body = [
      {
        accountId: input.accountId,
        itemType: 'EXTERNAL_CHARGE',
        description: input.description,
        amount: input.amountDollars,
        currency: 'USD',
      },
    ];
    const result = await this.request<Json & Record<string, Json>>(
      'POST',
      `/1.0/kb/invoices/charges/${input.accountId}?autoCommit=false`,
      body,
    );
    if (result.status >= 200 && result.status < 300 && Array.isArray(result.body) && result.body.length > 0) {
      const item = result.body[0] as Record<string, Json>;
      if (typeof item.invoiceId === 'string') return item.invoiceId;
    }
    throw new Error('Kill Bill invoice creation failed');
  }

  async commitInvoice(invoiceId: string): Promise<void> {
    const result = await this.request('PUT', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/commitInvoice`);
    if (result.status < 200 || result.status >= 300) throw new Error('Kill Bill invoice commit failed');
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const result = await this.request('DELETE', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}`);
    if (result.status < 200 || result.status >= 300) throw new Error('Kill Bill invoice void failed');
  }

  async invoiceStatus(invoiceId: string): Promise<string | null> {
    const result = await this.request<Json & Record<string, Json>>(
      'GET',
      `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}`,
    );
    if (result.status === 200 && result.body && typeof result.body === 'object') {
      const record = result.body as Record<string, Json>;
      const status = record.status;
      if (typeof status === 'string') return status;
    }
    throw new Error('Kill Bill invoice lookup failed');
  }
}
