// Kill Bill is the only source of payment truth (DP-14, DP-46).
// Every call returns the provider's answer; nothing is self-reported.

import { createHash } from 'node:crypto';

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export type KillBillResult<T> = { ok: true; value: T } | { ok: false; reason: 'unreachable' };

export interface PaymentTransaction {
  status: string;
  amount: number;
  transactionType: string;
}

export interface PaymentRecord {
  paymentId: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: PaymentTransaction[];
}

const TIMEOUT_MS = 5000;

export class KillBillClient {
  constructor(private readonly config: KillBillConfig) {}

  private async request<T>(path: string, init: RequestInit): Promise<KillBillResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.url}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
          'X-Killbill-ApiKey': this.config.apiKey,
          'X-Killbill-ApiSecret': this.config.apiSecret,
          'X-Killbill-CreatedBy': 'tallyslate',
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      if (response.ok) {
        const text = await response.text();
        const value = text.length === 0 ? (null as unknown as T) : (JSON.parse(text) as T);
        return { ok: true, value };
      }
      return { ok: false, reason: 'unreachable' };
    } catch {
      return { ok: false, reason: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${this.config.url}/1.0/kb/accounts/pagination?limit=1`, {
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
          'X-Killbill-ApiKey': this.config.apiKey,
          'X-Killbill-ApiSecret': this.config.apiSecret,
        },
      });
      return response.ok || response.status === 404;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async findAccountByEmail(email: string): Promise<KillBillResult<string | null>> {
    const result = await this.request<{ accountId: string }[]>(
      `/1.0/kb/accounts/search/${encodeURIComponent(email)}`,
      { method: 'GET' },
    );
    if (!result.ok) {
      return result;
    }
    const account = result.value.find((candidate) => candidate.accountId !== undefined);
    return { ok: true, value: account ? account.accountId : null };
  }

  async createAccount(name: string, email: string): Promise<KillBillResult<string>> {
    const externalKey = email.toLowerCase();
    const created = await this.request<unknown>('/1.0/kb/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, externalKey, currency: 'USD' }),
    });
    if (!created.ok && created.reason === 'unreachable') {
      // account may already exist
      const found = await this.findAccountByEmail(externalKey);
      if (!found.ok) {
        return found;
      }
      if (found.value !== null) {
        return { ok: true, value: found.value };
      }
      return created;
    }
    if (!created.ok) {
      return created;
    }
    const found = await this.findAccountByEmail(externalKey);
    if (!found.ok) {
      return found;
    }
    if (found.value === null) {
      return { ok: false, reason: 'unreachable' };
    }
    return { ok: true, value: found.value };
  }

  async ensurePaymentMethod(accountId: string, email: string): Promise<KillBillResult<string | null>> {
    const listed = await this.request<{ paymentMethodId: string; isDefault: boolean }[]>(
      `/1.0/kb/accounts/${accountId}/paymentMethods`,
      { method: 'GET' },
    );
    if (!listed.ok) {
      return listed;
    }
    const existing = listed.value.find((method) => method.isDefault);
    if (existing) {
      return { ok: true, value: existing.paymentMethodId };
    }
    // __EXTERNAL_PAYMENT__ allows one method per account; 7023 means it already exists.
    let method = listed.value.length > 0 ? listed.value[0] : null;
    if (method === null) {
      const created = await this.request<unknown>(
        `/1.0/kb/accounts/${accountId}/paymentMethods?pluginName=__EXTERNAL_PAYMENT__&setDefault=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalKey: `pm-${createHash('sha256').update(email).digest('hex').slice(0, 24)}`,
            isDefault: true,
            pluginName: '__EXTERNAL_PAYMENT__',
            pluginInfo: { isDefaultPaymentMethod: true, properties: [] },
          }),
        },
      );
      if (!created.ok) {
        return created;
      }
      const relisted = await this.request<{ paymentMethodId: string; isDefault: boolean }[]>(
        `/1.0/kb/accounts/${accountId}/paymentMethods`,
        { method: 'GET' },
      );
      if (!relisted.ok) {
        return relisted;
      }
      method = relisted.value.length > 0 ? relisted.value[0] : null;
      if (method === null) {
        return { ok: true, value: null };
      }
    }
    const defaulted = await this.request<unknown>(
      `/1.0/kb/accounts/${accountId}/paymentMethods/${method.paymentMethodId}/setDefault`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    if (!defaulted.ok) {
      return defaulted;
    }
    return { ok: true, value: method.paymentMethodId };
  }

  async purchase(accountId: string, paymentMethodId: string, ref: string, dollars: number): Promise<KillBillResult<PaymentRecord>> {
    const created = await this.request<PaymentRecord>(
      `/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${encodeURIComponent(paymentMethodId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentExternalKey: ref,
          transactionType: 'PURCHASE',
          amount: dollars,
          currency: 'USD',
          transactionExternalKey: `${ref}-confirm`,
        }),
      },
    );
    if (!created.ok) {
      // The transaction external key may already exist from an earlier attempt that
      // committed in Kill Bill before the caller saw the answer: read the payment back.
      const existing = await this.findPayment(ref);
      if (existing.ok && existing.value !== null) {
        return { ok: true, value: existing.value };
      }
      return created;
    }
    // The purchase answers 201 with a Location header and no body: the payment
    // record is the source of the transaction status.
    const payment = await this.findPayment(ref);
    if (payment.ok && payment.value !== null) {
      return { ok: true, value: payment.value };
    }
    return created;
  }

  async findPayment(ref: string): Promise<KillBillResult<PaymentRecord | null>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `${this.config.url}/1.0/kb/payments?externalKey=${encodeURIComponent(ref)}`,
        {
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
            'X-Killbill-ApiKey': this.config.apiKey,
            'X-Killbill-ApiSecret': this.config.apiSecret,
            'X-Killbill-CreatedBy': 'tallyslate',
          },
        },
      );
      if (response.status === 404) {
        return { ok: true, value: null };
      }
      if (response.ok) {
        return { ok: true, value: (await response.json()) as PaymentRecord };
      }
      return { ok: false, reason: 'unreachable' };
    } catch {
      return { ok: false, reason: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  async refund(paymentId: string, ref: string, dollars: number, suffix: string): Promise<KillBillResult<PaymentRecord>> {
    const refunded = await this.request<PaymentRecord>(`/1.0/kb/payments/${paymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: dollars,
        currency: 'USD',
        transactionExternalKey: `${ref}-${suffix}`,
      }),
    });
    if (!refunded.ok) {
      // The refund transaction may already exist from an attempt whose answer the
      // caller never saw: confirm it from the payment record before reporting failure.
      const payment = await this.findPayment(ref);
      if (payment.ok && payment.value !== null && refundSucceeded(payment.value)) {
        return { ok: true, value: payment.value };
      }
      return refunded;
    }
    return { ok: true, value: refunded.value };
  }

  async recordDamageInvoice(accountId: string, ref: string, dollars: number): Promise<KillBillResult<unknown>> {
    const created = await this.request<unknown>(
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            itemType: 'EXTERNAL_CHARGE',
            description: `Damage · ${ref}`,
            amount: dollars,
            currency: 'USD',
            startDate: new Date().toISOString().slice(0, 10),
          },
        ]),
      },
    );
    return created;
  }
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function purchaseSucceeded(record: PaymentRecord): boolean {
  return record.transactions.some(
    (transaction) => transaction.status === 'SUCCESS' && transaction.transactionType === 'PURCHASE',
  );
}

export function purchaseDeclined(record: PaymentRecord): boolean {
  return record.transactions.some(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status !== 'SUCCESS',
  );
}

export function refundSucceeded(record: PaymentRecord): boolean {
  return record.transactions.some(
    (transaction) => transaction.status === 'SUCCESS' && transaction.transactionType === 'REFUND',
  );
}
