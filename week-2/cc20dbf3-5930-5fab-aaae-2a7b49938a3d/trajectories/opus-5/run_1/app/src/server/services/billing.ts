import { centsToDollarString } from '../../domain/money.js';
import { DEPENDENCY_TIMEOUT_MS } from '../config.js';
import type { Config } from '../config.js';

/** Raised when the billing system cannot be reached; it carries no provider detail. */
export class BillingUnavailable extends Error {
  constructor() {
    super('billing unavailable');
    this.name = 'BillingUnavailable';
  }
}

interface KillBillTransaction {
  transactionExternalKey: string;
  transactionType: string;
  amount: number;
}

interface KillBillPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KillBillTransaction[];
}

interface KillBillAccount {
  accountId: string;
  externalKey: string;
}

export interface MemberAccountDetails {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
}

export class Billing {
  private readonly config: Config['killbill'];

  constructor(config: Config['killbill']) {
    this.config = config;
  }

  private headers(withBody: boolean): Record<string, string> {
    const basic = Buffer.from(`${this.config.username}:${this.config.password}`, 'utf8').toString('base64');
    const headers: Record<string, string> = {
      authorization: `Basic ${basic}`,
      'x-killbill-apikey': this.config.apiKey,
      'x-killbill-apisecret': this.config.apiSecret,
      'x-killbill-createdby': 'shedline',
      accept: 'application/json',
    };
    if (withBody) headers['content-type'] = 'application/json';
    return headers;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; location: string | null; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
    try {
      const request: RequestInit = {
        method,
        headers: this.headers(body !== undefined),
        signal: controller.signal,
      };
      if (body !== undefined) request.body = JSON.stringify(body);
      const response = await fetch(`${this.config.url}${path}`, request);
      const text = await response.text();
      if (response.status >= 500) throw new BillingUnavailable();
      return { status: response.status, location: response.headers.get('location'), text };
    } catch (error) {
      if (error instanceof BillingUnavailable) throw error;
      throw new BillingUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.url}/1.0/healthcheck`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One account per member, created the first time Shedline records money for them. */
  async ensureAccount(member: MemberAccountDetails): Promise<string> {
    const externalKey = `shedline-${member.memberId}`;
    const existing = await this.findAccount(externalKey);
    if (existing !== null) {
      await this.ensureExternalPaymentMethod(existing.accountId);
      return existing.accountId;
    }
    const created = await this.call('POST', '/1.0/kb/accounts', {
      externalKey,
      currency: 'USD',
      name: member.name,
      email: member.email,
    });
    if (created.status !== 201) {
      const found = await this.findAccount(externalKey);
      if (found === null) throw new BillingUnavailable();
      await this.ensureExternalPaymentMethod(found.accountId);
      return found.accountId;
    }
    const accountId = (created.location ?? '').split('/').filter((part) => part !== '').pop();
    if (accountId === undefined) throw new BillingUnavailable();
    await this.ensureExternalPaymentMethod(accountId);
    return accountId;
  }

  private async findAccount(externalKey: string): Promise<KillBillAccount | null> {
    const response = await this.call(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    );
    if (response.status === 404) return null;
    if (response.status !== 200) throw new BillingUnavailable();
    return JSON.parse(response.text) as KillBillAccount;
  }

  private async ensureExternalPaymentMethod(accountId: string): Promise<void> {
    const listed = await this.call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
    if (listed.status === 200) {
      const methods = JSON.parse(listed.text) as Array<{ pluginName: string }>;
      if (methods.some((method) => method.pluginName === '__EXTERNAL_PAYMENT__')) return;
    }
    await this.call(
      'POST',
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
      { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
    );
  }

  private async findPayment(paymentExternalKey: string): Promise<KillBillPayment | null> {
    const response = await this.call(
      'GET',
      `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}&withPluginInfo=false&withAttempts=false`,
    );
    if (response.status === 404) return null;
    if (response.status !== 200) throw new BillingUnavailable();
    return JSON.parse(response.text) as KillBillPayment;
  }

  /** Records a purchase once; an existing transaction with the key is reused. */
  async recordPurchase(
    accountId: string,
    paymentExternalKey: string,
    transactionExternalKey: string,
    amountCents: number,
  ): Promise<void> {
    const existing = await this.findPayment(paymentExternalKey);
    if (existing !== null && existing.transactions.some((tx) => tx.transactionExternalKey === transactionExternalKey)) {
      return;
    }
    const created = await this.call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
      transactionType: 'PURCHASE',
      amount: centsToDollarString(amountCents),
      currency: 'USD',
      paymentExternalKey,
      transactionExternalKey,
    });
    if (created.status !== 201) {
      const found = await this.findPayment(paymentExternalKey);
      if (found === null || !found.transactions.some((tx) => tx.transactionExternalKey === transactionExternalKey)) {
        throw new BillingUnavailable();
      }
    }
  }

  /** Records a refund on the deposit payment once; an existing one with the key is reused. */
  async recordRefund(
    paymentExternalKey: string,
    transactionExternalKey: string,
    amountCents: number,
  ): Promise<void> {
    const payment = await this.findPayment(paymentExternalKey);
    if (payment === null) throw new BillingUnavailable();
    if (payment.transactions.some((tx) => tx.transactionExternalKey === transactionExternalKey)) return;
    const created = await this.call('POST', `/1.0/kb/payments/${payment.paymentId}/refunds`, {
      amount: centsToDollarString(amountCents),
      currency: 'USD',
      transactionExternalKey,
    });
    if (created.status !== 201) {
      const found = await this.findPayment(paymentExternalKey);
      if (found === null || !found.transactions.some((tx) => tx.transactionExternalKey === transactionExternalKey)) {
        throw new BillingUnavailable();
      }
    }
  }
}

export function depositPaymentKey(loanId: string): string {
  return `shedline-${loanId}-deposit`;
}

export function depositHoldTransactionKey(loanId: string): string {
  return `shedline-${loanId}-deposit-hold`;
}

export function depositReleaseTransactionKey(loanId: string): string {
  return `shedline-${loanId}-deposit-release`;
}

export function extraDamageKey(loanId: string): string {
  return `shedline-${loanId}-extra-damage`;
}

export function lateFeeKey(loanId: string): string {
  return `shedline-${loanId}-late-fee`;
}
