import { billingUnavailable } from '../shared/errors.js';

// Kill Bill client. One account per enrolment, one PURCHASE and one REFUND.

export interface PurchaseResult {
  transactionId: string;
  amount: number;
  status: 'SUCCESS' | string;
}

export interface RefundResult {
  transactionId: string;
  status: 'SUCCESS' | string;
}

interface KbTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: number;
  processedAmount: number;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KbTransaction[];
}

interface KbAccount {
  accountId: string;
  externalKey: string;
  paymentMethodId: string | null;
}

const TIMEOUT_MS = 10_000;

export class KillBillClient {
  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'X-Killbill-ApiKey': this.apiKey,
      'X-Killbill-ApiSecret': this.apiSecret,
      'X-Killbill-CreatedBy': 'lanternfish',
      ...extra,
    };
  }

  private async request(method: string, path: string, body?: string, headers: Record<string, string> = {}, allowStatuses: readonly number[] = []): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, ...this.headers(headers) },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok && !allowStatuses.includes(response.status)) {
        throw new Error(`killbill ${response.status}: ${text.slice(0, 200)}`);
      }
      return { status: response.status, text };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw billingUnavailable();
      if (err instanceof Error && (err.message.startsWith('killbill 5') || err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))) {
        throw err.message.startsWith('killbill 5') ? billingUnavailable() : billingUnavailable();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Account lookup by external key. null when absent.
  async findAccount(externalKey: string): Promise<KbAccount | null> {
    try {
      const { status, text } = await this.request('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}`);
      if (status !== 200) return null;
      const list = JSON.parse(text) as KbAccount[];
      return list.length === 0 ? null : (list[0] as KbAccount);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('killbill ')) {
        const code = Number(err.message.split(' ')[1]);
        if (code >= 500) throw billingUnavailable();
      }
      throw err;
    }
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    const existing = await this.findAccount(externalKey);
    if (existing) return existing;
    const body = JSON.stringify({ externalKey, name, email, currency: 'USD' });
    try {
      const { status, text } = await this.request('POST', '/1.0/kb/accounts', body, { 'Content-Type': 'application/json' }, [400, 409, 410]);
      if (status === 201) {
        // fetch the created account
        const found = await this.findAccount(externalKey);
        if (found) return found;
        throw new Error(`killbill account create returned ${status}: ${text.slice(0, 100)}`);
      }
      // 400/409/410 might mean a race: another process created it
      const found = await this.findAccount(externalKey);
      if (found) return found;
      throw billingUnavailable();
    } catch (err) {
      if (err instanceof Error && err.message.includes('ECONNREFUSED')) throw billingUnavailable();
      throw err;
    }
  }

  async ensurePaymentMethod(accountId: string): Promise<string> {
    const { status, text } = await this.request('POST', `/1.0/kb/accounts/${accountId}/paymentMethods`, JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__', isDefault: true }), { 'Content-Type': 'application/json' }, [400, 409, 410]);
    const methods = JSON.parse(await this.request('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`).then((r) => r.text)) as { paymentMethodId: string }[];
    const first = methods[0];
    if (!first) throw new Error(`no payment method for ${accountId} (${status} ${text.slice(0, 80)})`);
    return first.paymentMethodId;
  }

  async paymentsFor(accountId: string, externalKey: string): Promise<KbPayment[]> {
    const { status, text } = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments`);
    if (status !== 200) throw new Error(`killbill payments ${status}`);
    const all = JSON.parse(text) as KbPayment[];
    return all.filter((p) => p.paymentExternalKey === externalKey);
  }

  async createPurchase(accountId: string, paymentMethodId: string, paymentExternalKey: string, transactionExternalKey: string, dollars: number): Promise<KbTransaction> {
    const body = JSON.stringify({
      paymentExternalKey,
      transactionExternalKey,
      transactionType: 'PURCHASE',
      amount: dollars,
      currency: 'USD',
    });
    const { status, text } = await this.request('POST', `/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`, body, { 'Content-Type': 'application/json' }, [400, 402, 409, 410]);
    if (status === 201) {
      const payments = await this.paymentsFor(accountId, paymentExternalKey);
      const payment = payments[0];
      const txn = payment?.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
      if (txn) return txn;
      throw new Error(`purchase txn not found after create: ${text.slice(0, 100)}`);
    }
    if (status === 409) {
      // A concurrent create already made it; read it back.
      const payments = await this.paymentsFor(accountId, paymentExternalKey);
      const payment = payments[0];
      const txn = payment?.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
      if (txn) return txn;
    }
    throw new Error(`killbill purchase ${status}: ${text.slice(0, 200)}`);
  }

  async createRefund(accountId: string, paymentId: string, transactionExternalKey: string, dollars: number): Promise<KbTransaction> {
    const body = JSON.stringify({ transactionExternalKey, amount: dollars, currency: 'USD' });
    const { status, text } = await this.request('POST', `/1.0/kb/payments/${paymentId}/refunds`, body, { 'Content-Type': 'application/json' }, [400, 409, 410]);
    if (status === 201) {
      const payments = await this.paymentsFor(accountId, `${transactionExternalKey.replace(/-refund$/, '')}`);
      const payment = payments[0];
      const txn = payment?.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
      if (txn) return txn;
      throw new Error(`refund txn not found: ${text.slice(0, 100)}`);
    }
    if (status === 409) {
      const payments = await this.paymentsFor(accountId, transactionExternalKey.replace(/-refund$/, ''));
      const payment = payments[0];
      const txn = payment?.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
      if (txn) return txn;
    }
    throw new Error(`killbill refund ${status}: ${text.slice(0, 200)}`);
  }

  async findSuccessfulPurchase(enrolmentId: string): Promise<KbTransaction | null> {
    const account = await this.findAccount(enrolmentId);
    if (!account) return null;
    const payments = await this.paymentsFor(account.accountId, enrolmentId);
    for (const p of payments) {
      const txn = p.transactions.find((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS');
      if (txn) return txn;
    }
    return null;
  }
}
