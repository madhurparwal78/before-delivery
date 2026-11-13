import type { AppConfig } from '../config';
import type { CurrencyCode } from '../money';

export interface KbInvoiceItem {
  description: string;
  amount: number;
}

export interface KbPaymentResult {
  paymentId: string;
  amount: number;
}

export interface KbRefund {
  killbillPaymentId: string;
  amount: number;
  transactionKey: string;
}

export class KillBill {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: AppConfig) {
    this.baseUrl = config.killbill.url;
    this.authHeader = 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
    this.apiKey = config.killbill.apiKey;
    this.apiSecret = config.killbill.apiSecret;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'X-Killbill-ApiKey': this.apiKey,
      'X-Killbill-ApiSecret': this.apiSecret,
      'X-Killbill-CreatedBy': 'gloamwork-shot-rig',
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/1.0/healthcheck`, {
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async findAccountByExternalKey(externalKey: string): Promise<string | null> {
    const search = await this.request('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}?api_key=${encodeURIComponent(this.apiKey)}&limit=1`);
    if (search.ok) {
      const accounts = await search.json() as { accountId: string; externalKey: string }[];
      const match = accounts.find(account => account.externalKey === externalKey);
      if (match) {
        return match.accountId;
      }
      return null;
    }
    if (search.status === 404) {
      return null;
    }
    throw new Error('unreachable');
  }

  async createAccount(externalKey: string, name: string, email: string, currency: CurrencyCode): Promise<string> {
    const response = await this.request('POST', '/1.0/kb/accounts', {
      name,
      externalKey,
      currency,
      email,
    });
    const location = response.headers.get('Location');
    if (location) {
      const segments = location.split('/').filter(segment => segment.length > 0);
      return segments[segments.length - 1];
    }
    // The account may already exist (concurrent creation); fall back to the lookup.
    const existing = await this.findAccountByExternalKey(externalKey);
    if (existing) {
      return existing;
    }
    throw new Error('Kill Bill account creation failed');
  }

  private async ensurePaymentMethod(accountId: string): Promise<string> {
    const listResponse = await this.request('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
    const methods = listResponse.ok ? await listResponse.json() as { paymentMethodId: string; isDefault: boolean }[] : [];
    if (methods.length > 0) {
      const first = methods[0];
      if (!first.isDefault) {
        await this.request('PUT', `/1.0/kb/accounts/${accountId}/paymentMethods/${first.paymentMethodId}/setDefault`);
      }
      return first.paymentMethodId;
    }
    const create = await this.request('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?pluginName=__EXTERNAL_PAYMENT__&isDefault=true`, {
      pluginName: '__EXTERNAL_PAYMENT__',
      isDefault: true,
    });
    if (create.status !== 201) {
      throw new Error(`Payment method creation failed: ${create.status}`);
    }
    const location = create.headers.get('Location');
    if (location) {
      const segments = location.split('/').filter(segment => segment.length > 0);
      return segments[segments.length - 1];
    }
    const list = await this.request('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
    const created = await list.json() as { paymentMethodId: string }[];
    return created[0].paymentMethodId;
  }

  async ensureAccount(externalKey: string, name: string, email: string, currency: CurrencyCode): Promise<string> {
    const existing = await this.findAccountByExternalKey(externalKey);
    if (existing) {
      return existing;
    }
    return this.createAccount(externalKey, name, email, currency);
  }

  /** Create an invoice of external charges; returns the Kill Bill invoice id and number. */
  async createInvoice(accountId: string, currency: CurrencyCode, exponent: number, items: KbInvoiceItem[], externalKey?: string): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const query = externalKey ? `?autoCommit=true&externalKey=${encodeURIComponent(externalKey)}` : '?autoCommit=true';
    const response = await this.request('POST', `/1.0/kb/invoices/charges/${accountId}${query}`, items.map(item => ({
      amount: this.majorUnits(item.amount, exponent),
      currency,
      description: item.description,
      quantity: 1,
    })));
    if (response.status !== 200 && response.status !== 201) {
      const text = await response.text();
      throw new Error(`Kill Bill invoice creation failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const created = await response.json() as { invoiceId: string }[];
    const invoiceId = created[0].invoiceId;
    const invoice = await this.getInvoice(invoiceId);
    return { invoiceId, invoiceNumber: invoice.invoiceNumber };
  }

  async getInvoice(invoiceId: string): Promise<{ invoiceId: string; invoiceNumber: string; status: string; balance: number; amount: number }> {
    const response = await this.request('GET', `/1.0/kb/invoices/${invoiceId}`);
    if (!response.ok) {
      throw new Error(`Kill Bill invoice fetch failed: ${response.status}`);
    }
    return await response.json() as { invoiceId: string; invoiceNumber: string; status: string; balance: number; amount: number };
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const response = await this.request('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`);
    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(`Kill Bill void failed: ${response.status} ${text.slice(0, 200)}`);
    }
  }

  async findInvoiceByDescription(accountId: string, description: string): Promise<string | null> {
    const response = await this.request('GET', `/1.0/kb/accounts/${accountId}/invoices?withItems=true`);
    if (!response.ok) {
      throw new Error(`Kill Bill invoice list failed: ${response.status}`);
    }
    const invoices = await response.json() as { invoiceId: string; status: string; items: { description: string }[] }[];
    for (const invoice of invoices) {
      if (invoice.items?.some(item => item.description === description)) {
        return invoice.invoiceId;
      }
    }
    return null;
  }

  async purchase(invoiceId: string, accountId: string, currency: CurrencyCode, exponent: number, amountMinor: number, paymentExternalKey: string): Promise<KbPaymentResult> {
    await this.ensurePaymentMethod(accountId);
    const response = await this.request('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
      accountId,
      currency,
      purchasedAmount: this.majorUnits(amountMinor, exponent),
      paymentExternalKey,
      transactions: [{
        transactionType: 'PURCHASE',
        amount: this.majorUnits(amountMinor, exponent),
        currency,
        transactionExternalKey: paymentExternalKey,
        status: 'SUCCESS',
      }],
    });
    if (response.status !== 201) {
      const text = await response.text();
      throw new Error(`Kill Bill payment failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const location = response.headers.get('Location');
    let paymentId: string;
    if (location) {
      const segments = location.split('/').filter(segment => segment.length > 0);
      paymentId = segments[segments.length - 1];
    } else {
      const invoicePayments = await this.request('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
      const payments = await invoicePayments.json() as { paymentId: string; paymentExternalKey: string }[];
      const match = payments.find(p => p.paymentExternalKey === paymentExternalKey);
      paymentId = match ? match.paymentId : payments[payments.length - 1].paymentId;
    }
    return { paymentId, amount: amountMinor };
  }

  async getPayment(paymentId: string): Promise<{ paymentId: string; purchasedAmount: number; refundedAmount: number; transactions: { transactionId: string; transactionType: string; transactionExternalKey: string; status: string; amount: number }[] }> {
    const response = await this.request('GET', `/1.0/kb/payments/${paymentId}`);
    if (!response.ok) {
      throw new Error(`Kill Bill payment fetch failed: ${response.status}`);
    }
    return await response.json() as { paymentId: string; purchasedAmount: number; refundedAmount: number; transactions: { transactionId: string; transactionType: string; transactionExternalKey: string; status: string; amount: number }[] };
  }

  async listPayments(accountId: string): Promise<{ paymentId: string; paymentExternalKey: string; purchasedAmount: number; refundedAmount: number; targetInvoiceId: string | null }[]> {
    const response = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments?withPayments=true`);
    if (!response.ok) {
      throw new Error(`Kill Bill payments list failed: ${response.status}`);
    }
    return await response.json() as { paymentId: string; paymentExternalKey: string; purchasedAmount: number; refundedAmount: number; targetInvoiceId: string | null }[];
  }

  async refund(paymentId: string, currency: CurrencyCode, exponent: number, amountMinor: number, transactionKey: string): Promise<KbRefund> {
    const response = await this.request('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      amount: this.majorUnits(amountMinor, exponent),
      currency,
      transactionExternalKey: transactionKey,
      status: 'SUCCESS',
    });
    if (response.status !== 201) {
      const text = await response.text();
      throw new Error(`Kill Bill refund failed: ${response.status} ${text.slice(0, 200)}`);
    }
    return { killbillPaymentId: paymentId, amount: amountMinor, transactionKey };
  }

  async getBlockingStates(accountId: string): Promise<{ stateName: string; service: string; effectiveDate: string }[]> {
    const response = await this.request('GET', `/1.0/kb/accounts/${accountId}/block?blockingStateSvcs=gloamwork-billing`);
    if (!response.ok) {
      throw new Error(`Kill Bill blocking states failed: ${response.status}`);
    }
    return await response.json() as { stateName: string; service: string; effectiveDate: string }[];
  }

  async setBlockingState(accountId: string, stateName: 'OVERDUE' | 'CLEAR'): Promise<void> {
    const response = await this.request('POST', `/1.0/kb/accounts/${accountId}/block`, {
      blockedId: accountId,
      stateName,
      service: 'gloamwork-billing',
      isBlockChange: false,
      isBlockEntitlement: false,
      isBlockBilling: false,
      type: 'ACCOUNT',
      effectiveDate: new Date().toISOString(),
    });
    if (response.status !== 201) {
      throw new Error(`Kill Bill blocking state failed: ${response.status}`);
    }
  }

  private majorUnits(amountMinor: number, exponent: number): number {
    if (exponent === 0) {
      return amountMinor;
    }
    const divisor = 10 ** exponent;
    const whole = Math.trunc(amountMinor / divisor);
    const fraction = amountMinor % divisor;
    return whole + fraction / divisor;
  }
}
