export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export type PaymentOutcome =
  | { kind: 'success'; paymentId: string }
  | { kind: 'declined' }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

export class UnreachableError extends Error {}

/** Kill Bill client. Discovery: the dev instance mounts the JAX-RS API under /1.0/kb with basic admin auth. */
export class KillBill {
  constructor(private readonly config: KillBillConfig) {}

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      'X-Killbill-ApiKey': this.config.apiKey,
      'X-Killbill-ApiSecret': this.config.apiSecret,
      'X-Killbill-CreatedBy': 'kerfwell',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; location: string | null }> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new UnreachableError('Kill Bill is unreachable');
    }
    const location = response.headers.get('location');
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json, location };
  }

  async ping(): Promise<boolean> {
    try {
      const result = await fetch(`${this.config.url}/1.0/kb/tenants?apiKey=${encodeURIComponent(this.config.apiKey)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return result.ok;
    } catch {
      return false;
    }
  }

  /** Find or create the maker's single account, returning its id. */
  async ensureAccount(externalKey: string, name: string, email: string): Promise<string | null> {
    let search: Awaited<ReturnType<KillBill['request']>>;
    try {
      search = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    } catch {
      throw new UnreachableError('Kill Bill is unreachable');
    }
    if (search.status === 200) {
      const record = search.json as Record<string, unknown> | null;
      if (record && typeof record.accountId === 'string') return record.accountId;
    }
    let create: Awaited<ReturnType<KillBill['request']>>;
    try {
      create = await this.request('POST', '/1.0/kb/accounts', {
        externalKey,
        name,
        email,
        currency: 'USD',
      });
    } catch {
      throw new UnreachableError('Kill Bill is unreachable');
    }
    if (create.status === 201 && create.location) {
      const match = create.location.match(/accounts\/([0-9a-f-]{36})/);
      if (match) return match[1];
    }
    if (create.status === 400 || create.status === 409 || create.status === 422) {
      // Another instance created it first; read it back.
      let retry: Awaited<ReturnType<KillBill['request']>>;
      try {
        retry = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      } catch {
        throw new UnreachableError('Kill Bill is unreachable');
      }
      if (retry.status === 200) {
        const record = retry.json as Record<string, unknown> | null;
        if (record && typeof record.accountId === 'string') return record.accountId;
      }
    }
    return null;
  }

  async hasDefaultPaymentMethod(accountId: string): Promise<boolean> {
    let result: Awaited<ReturnType<KillBill['request']>>;
    try {
      result = await this.request('GET', `/1.0/kb/accounts/${accountId}`);
    } catch {
      throw new UnreachableError('Kill Bill is unreachable');
    }
    if (result.status !== 200) return false;
    const account = result.json as Record<string, unknown>;
    return typeof account.paymentMethodId === 'string' && account.paymentMethodId.length > 0;
  }

  async addPaymentMethod(accountId: string, externalId: string): Promise<string | null> {
    let result: Awaited<ReturnType<KillBill['request']>>;
    try {
      result = await this.request('POST', `/1.0/kb/accounts/${accountId}/paymentMethods`, {
        pluginName: '__EXTERNAL_PAYMENT__',
        isDefault: true,
        pluginInfo: { isDefaultPaymentMethod: true, externalPaymentMethodId: externalId },
      });
    } catch {
      throw new UnreachableError('Kill Bill is unreachable');
    }
    if (result.status === 201 && result.location) {
      const match = result.location.match(/paymentMethods\/([0-9a-f-]{36})/);
      const methodId = match ? match[1] : null;
      if (methodId !== null) {
        // The create body's isDefault flag is not honoured; make it default explicitly.
        try {
          await this.request('PUT', `/1.0/kb/accounts/${accountId}/paymentMethods/${methodId}/setDefault`);
        } catch {
          throw new UnreachableError('Kill Bill is unreachable');
        }
      }
      return methodId;
    }
    return null;
  }

  /** PURCHASE in dollars; returns the payment id on success. */
  async purchase(accountId: string, amountCents: number, paymentExternalKey: string): Promise<PaymentOutcome> {
    const body = {
      transactionType: 'PURCHASE',
      amount: (amountCents / 100).toFixed(2),
      currency: 'USD',
      paymentExternalKey,
      properties: [],
    };
    let response: Awaited<ReturnType<KillBill['request']>>;
    try {
      response = await this.request('POST', `/1.0/kb/accounts/${accountId}/payments`, body);
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 404 || response.status === 400) {
      const message = typeof (response.json as { message?: string } | null)?.message === 'string'
        ? (response.json as { message: string }).message
        : '';
      if (message.includes('Invalid payment transition')) return { kind: 'failed' };
    }
    if (response.status >= 500) return { kind: 'failed' };
    const payments = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments?paymentExternalKey=${encodeURIComponent(paymentExternalKey)}`);
    if (payments.status !== 200) return { kind: 'failed' };
    const list = payments.json as Array<Record<string, unknown>>;
    const payment = list.find((p) => p.paymentExternalKey === paymentExternalKey);
    if (!payment) return { kind: 'failed' };
    const transactions = (payment.transactions as Array<Record<string, unknown>>) ?? [];
    const purchase = transactions.find((t) => t.transactionType === 'PURCHASE');
    if (!purchase) return { kind: 'failed' };
    const status = purchase.status as string;
    const paymentId = payment.paymentId as string;
    if (status === 'SUCCESS') return { kind: 'success', paymentId };
    if (status === 'PLUGIN_FAILURE') return { kind: 'failed' };
    if (status === 'PAYMENT_FAILURE') return { kind: 'failed' };
    return { kind: 'failed' };
  }

  /** REFUND of the deposit on a payment. */
  async refund(accountId: string, paymentId: string, amountCents: number): Promise<PaymentOutcome> {
    const body = {
      transactionType: 'REFUND',
      amount: (amountCents / 100).toFixed(2),
      currency: 'USD',
      properties: [],
    };
    let response: Awaited<ReturnType<KillBill['request']>>;
    try {
      response = await this.request('POST', `/1.0/kb/payments/${paymentId}/refunds`, body);
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 404) return { kind: 'failed' };
    if (response.status >= 500) return { kind: 'failed' };
    const payments = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments`);
    if (payments.status !== 200) return { kind: 'failed' };
    const list = payments.json as Array<Record<string, unknown>>;
    const payment = list.find((p) => p.paymentId === paymentId);
    if (!payment) return { kind: 'failed' };
    const transactions = (payment.transactions as Array<Record<string, unknown>>) ?? [];
    const refund = [...transactions].reverse().find((t) => t.transactionType === 'REFUND');
    if (!refund) return { kind: 'failed' };
    const status = refund.status as string;
    if (status === 'SUCCESS') return { kind: 'success', paymentId };
    return { kind: 'failed' };
  }
}
