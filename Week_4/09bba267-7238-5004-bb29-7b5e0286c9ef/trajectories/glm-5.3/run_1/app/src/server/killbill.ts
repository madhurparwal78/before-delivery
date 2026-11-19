import { createHash, randomUUID } from 'node:crypto';

export type KillBillConfig = {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
};

export type PaymentResult = { outcome: 'confirmed'; paymentId: string } | { outcome: 'declined' } | { outcome: 'unreachable' };
export type RefundResult = { outcome: 'confirmed'; transactionId: string } | { outcome: 'declined' } | { outcome: 'unreachable' };

export type KillBillPayment = {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: Array<{
    transactionId: string;
    transactionExternalKey: string;
    transactionType: 'PURCHASE' | 'REFUND' | string;
    amount: number;
    status: string;
    effectiveDate: string;
  }>;
};

const TEN_SECONDS_MS = 10_000;

export class KillBillClient {
  constructor(private readonly config: KillBillConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'X-Killbill-ApiVersion': '1.0',
      'X-Killbill-ApiKey': this.config.apiKey,
      'X-Killbill-ApiSecret': this.config.apiSecret,
      'X-Killbill-CreatedBy': 'halyard-seatwise',
      ...extra,
    };
  }

  async ensureAccount(externalKey: string, name: string): Promise<string | null> {
    const existing = await this.request<unknown>('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}`, {
      timeout: TEN_SECONDS_MS,
    });
    if (existing.ok && Array.isArray(existing.value)) {
      const match = (existing.value as Array<{ accountId: string; externalKey: string }>).find(
        (a) => a.externalKey === externalKey,
      );
      if (match) return match.accountId;
    }
    const created = await this.request<unknown>('POST', '/1.0/kb/accounts', {
      timeout: TEN_SECONDS_MS,
      body: JSON.stringify({ externalKey, name, currency: 'USD' }),
    });
    if (!created.ok) return null;
    const fetched = await this.request<unknown>('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}`, {
      timeout: TEN_SECONDS_MS,
    });
    if (fetched.ok && Array.isArray(fetched.value)) {
      const match = (fetched.value as Array<{ accountId: string; externalKey: string }>).find((a) => a.externalKey === externalKey);
      if (match) return match.accountId;
    }
    return null;
  }

  async ensurePaymentMethod(accountId: string, externalKey: string): Promise<void> {
    const existing = await this.request<Array<{ paymentMethodId: string; pluginName: string }>>(
      'GET',
      `/1.0/kb/accounts/${accountId}/paymentMethods`,
      { timeout: TEN_SECONDS_MS },
    );
    if (existing.ok && Array.isArray(existing.value) && existing.value.length > 0) {
      const external = existing.value.find((pm) => pm.pluginName === '__EXTERNAL_PAYMENT__');
      if (external) return;
    }
    await this.request<unknown>('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true&pluginName=__EXTERNAL_PAYMENT__`, {
      timeout: TEN_SECONDS_MS,
      body: JSON.stringify({ externalKey, pluginName: '__EXTERNAL_PAYMENT__', isDefault: true }),
    });
  }

  async purchase(accountId: string, paymentExternalKey: string, transactionExternalKey: string, amountCents: number): Promise<PaymentResult> {
    const response = await this.request<KillBillPayment>('POST', `/1.0/kb/accounts/${accountId}/payments`, {
      timeout: TEN_SECONDS_MS,
      body: JSON.stringify({
        transactionType: 'PURCHASE',
        amount: centsToDollars(amountCents),
        currency: 'USD',
        paymentExternalKey,
        transactionExternalKey,
      }),
    });
    if (!response.ok) {
      return response.status >= 500 || response.status === 0 ? { outcome: 'unreachable' } : { outcome: 'declined' };
    }
    if (response.value) {
      const fromBody = this.toPaymentResult(response);
      if (fromBody.outcome === 'confirmed') return fromBody;
    }
    const fetched = await this.request<unknown>('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`, {
      timeout: TEN_SECONDS_MS,
    });
    if (fetched.ok) {
      const candidates = Array.isArray(fetched.value) ? fetched.value : [fetched.value];
      const payment = candidates.map((p) => this.readPayment(p)).find((p): p is KillBillPayment => p !== null);
      const transaction = payment?.transactions.find(
        (t) => t.transactionExternalKey === transactionExternalKey && t.transactionType === 'PURCHASE',
      );
      if (transaction && payment) {
        return transaction.status === 'SUCCESS' ? { outcome: 'confirmed', paymentId: payment.paymentId } : { outcome: 'declined' };
      }
    }
    return { outcome: 'declined' };
  }

  async refund(paymentId: string, transactionExternalKey: string, amountCents: number): Promise<RefundResult> {
    const response = await this.request<KillBillPayment>('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      timeout: TEN_SECONDS_MS,
      body: JSON.stringify({
        transactionType: 'REFUND',
        amount: centsToDollars(amountCents),
        currency: 'USD',
        transactionExternalKey,
        paymentId,
      }),
    });
    if (!response.ok) {
      return response.status >= 500 || response.status === 0 ? { outcome: 'unreachable' } : { outcome: 'declined' };
    }
    const fetched = await this.request<KillBillPayment>('GET', `/1.0/kb/payments/${paymentId}`, {
      timeout: TEN_SECONDS_MS,
    });
    if (fetched.ok && fetched.value) {
      const payment = this.readPayment(fetched.value);
      const transaction = payment?.transactions.find((t) => t.transactionExternalKey === transactionExternalKey);
      if (transaction) {
        return transaction.status === 'SUCCESS'
          ? { outcome: 'confirmed', transactionId: transaction.transactionId }
          : { outcome: 'declined' };
      }
    }
    return { outcome: 'declined' };
  }

  async paymentsForAccount(accountId: string): Promise<KillBillPayment[]> {
    const response = await this.request<KillBillPayment[]>('GET', `/1.0/kb/accounts/${accountId}/payments`, {
      timeout: TEN_SECONDS_MS,
    });
    if (!response.ok || !Array.isArray(response.value)) return [];
    return response.value.map((p) => this.readPayment(p)).filter((p): p is KillBillPayment => p !== null);
  }

  private readPayment(value: unknown): KillBillPayment | null {
    if (typeof value !== 'object' || value === null) return null;
    const raw = value as Record<string, unknown>;
    const transactionsRaw = Array.isArray(raw.transactions) ? raw.transactions : [];
    const transactions = transactionsRaw.map((t) => {
      const tx = t as Record<string, unknown>;
      return {
        transactionId: String(tx.transactionId ?? ''),
        transactionExternalKey: String(tx.transactionExternalKey ?? ''),
        transactionType: String(tx.transactionType ?? ''),
        amount: Number(tx.amount ?? 0),
        status: String(tx.status ?? ''),
        effectiveDate: String(tx.effectiveDate ?? ''),
      };
    });
    return {
      paymentId: String(raw.paymentId ?? ''),
      paymentExternalKey: String(raw.paymentExternalKey ?? ''),
      purchasedAmount: Number(raw.purchasedAmount ?? 0),
      refundedAmount: Number(raw.refundedAmount ?? 0),
      transactions,
    };
  }

  private toPaymentResult(response: Awaited<ReturnType<KillBillClient['request']>>): PaymentResult {
    if (!response.ok) {
      return response.status >= 500 || response.status === 0 ? { outcome: 'unreachable' } : { outcome: 'declined' };
    }
    const payment = this.readPayment(response.value);
    const transaction = payment?.transactions.find((t) => t.status === 'SUCCESS' && t.transactionType === 'PURCHASE');
    if (!payment || !transaction) return { outcome: 'declined' };
    return { outcome: 'confirmed', paymentId: payment.paymentId };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { timeout: number; body?: string },
  ): Promise<{ ok: boolean; status: number; value: T | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout);
    try {
      const url = `${this.config.url.replace(/\/$/, '')}${path}`;
      const response = await fetch(url, {
        method,
        headers: this.headers(options.body ? { 'Content-Type': 'application/json' } : {}),
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      let value: T | null = null;
      if (text.length > 0) {
        try {
          value = JSON.parse(text) as T;
        } catch {
          value = null;
        }
      }
      const ok = response.status >= 200 && response.status < 300;
      return { ok, status: response.status, value };
    } catch {
      return { ok: false, status: 0, value: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function paymentExternalKeyForOrder(orderId: string): string {
  return orderId;
}

export function exchangePaymentExternalKey(orderId: string, n: number): string {
  return `${orderId}-exchange-${n}`;
}

export function purchaseTransactionKey(paymentExternalKey: string): string {
  return `${paymentExternalKey}-purchase`;
}

export function refundTransactionKey(paymentExternalKey: string, n: number): string {
  return `${paymentExternalKey}-refund-${n}`;
}

export function idempotencyFingerprint(bodyText: string): string {
  return createHash('sha256').update(bodyText).digest('hex');
}

export function offerPaymentExternalKey(orderId: string): string {
  return orderId;
}

export { randomUUID };
