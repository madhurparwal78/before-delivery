import type { Config } from '../config';
import type { Paise } from '../domain/money';

export class PaymentUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'PaymentUnavailableError';
    this.cause = cause;
  }
}

const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const CREATED_BY = 'pakka-rail';
const TIMEOUT_MS = 8_000;

function amountInRupees(paise: Paise): number {
  return Math.round(paise) / 100;
}

interface KillBillAccount {
  readonly accountId: string;
}

interface KillBillTransaction {
  readonly transactionId: string;
  readonly transactionType: string;
  readonly status: string;
  readonly transactionExternalKey: string;
}

interface KillBillPayment {
  readonly paymentId: string;
  readonly transactions: readonly KillBillTransaction[];
}

export class KillBill {
  constructor(private readonly config: Config) {}

  private headers(json: boolean): Record<string, string> {
    const { username, password, apiKey, apiSecret } = this.config.killbill;
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'X-Killbill-ApiKey': apiKey,
      'X-Killbill-ApiSecret': apiSecret,
      'X-Killbill-CreatedBy': CREATED_BY,
      Accept: 'application/json',
    };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; location: string | null; json: unknown }> {
    let response: Response;
    try {
      response = await fetch(`${this.config.killbill.url}${path}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaymentUnavailableError(error);
    }
    if (response.status >= 500) {
      throw new PaymentUnavailableError(new Error(`Kill Bill answered ${response.status}`));
    }
    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, location: response.headers.get('location'), json };
  }

  /** One Kill Bill account per traveller, with the built-in external payment method as default. */
  async ensureAccount(accountId: string, name: string): Promise<string> {
    const externalKey = `pakka-${accountId}`;
    const found = await this.call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (found.status === 200 && found.json !== null) {
      const account = found.json as KillBillAccount;
      if (typeof account.accountId === 'string') {
        await this.ensurePaymentMethod(account.accountId, externalKey);
        return account.accountId;
      }
    }
    const created = await this.call('POST', '/1.0/kb/accounts', {
      name,
      externalKey,
      currency: 'INR',
    });
    const location = created.location;
    if (location === null) {
      const retry = await this.call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      const account = retry.json as KillBillAccount | null;
      if (account === null || typeof account.accountId !== 'string') {
        throw new PaymentUnavailableError(new Error('Kill Bill did not create the account'));
      }
      await this.ensurePaymentMethod(account.accountId, externalKey);
      return account.accountId;
    }
    const killbillAccountId = location.slice(location.lastIndexOf('/') + 1);
    await this.ensurePaymentMethod(killbillAccountId, externalKey);
    return killbillAccountId;
  }

  private async ensurePaymentMethod(killbillAccountId: string, externalKey: string): Promise<void> {
    const existing = await this.call('GET', `/1.0/kb/accounts/${killbillAccountId}/paymentMethods`);
    if (Array.isArray(existing.json) && existing.json.length > 0) return;
    await this.call(
      'POST',
      `/1.0/kb/accounts/${killbillAccountId}/paymentMethods?isDefault=true`,
      { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {}, externalKey: `${externalKey}-external` },
    );
  }

  /** One PURCHASE payment per booking, keyed by the PNR, SUCCESS before the PNR is returned. */
  async purchase(
    killbillAccountId: string,
    pnr: string,
    totalPaise: Paise,
  ): Promise<{ paymentId: string }> {
    const created = await this.call(
      'POST',
      `/1.0/kb/accounts/${killbillAccountId}/payments`,
      {
        transactionType: 'PURCHASE',
        amount: amountInRupees(totalPaise),
        currency: 'INR',
        paymentExternalKey: pnr,
        transactionExternalKey: `${pnr}-fare`,
      },
    );
    if (created.status >= 400) {
      throw new PaymentUnavailableError(new Error(`Kill Bill refused the purchase (${created.status})`));
    }
    const payment = await this.paymentByExternalKey(pnr);
    const fare = payment?.transactions.find(
      (transaction) => transaction.transactionExternalKey === `${pnr}-fare`,
    );
    if (payment === null || fare === undefined || fare.status !== 'SUCCESS') {
      throw new PaymentUnavailableError(new Error('Kill Bill did not record a SUCCESS purchase'));
    }
    return { paymentId: payment.paymentId };
  }

  async paymentByExternalKey(pnr: string): Promise<KillBillPayment | null> {
    const found = await this.call(
      'GET',
      `/1.0/kb/payments?externalKey=${encodeURIComponent(pnr)}&withPluginInfo=false`,
    );
    if (found.status !== 200 || found.json === null) return null;
    const payment = found.json as KillBillPayment;
    return typeof payment.paymentId === 'string' ? payment : null;
  }

  /** A REFUND transaction on the booking's payment. */
  async refund(
    paymentId: string,
    transactionExternalKey: string,
    amountPaise: Paise,
  ): Promise<boolean> {
    const existing = await this.call('GET', `/1.0/kb/payments/${paymentId}`);
    const payment = existing.json as KillBillPayment | null;
    const already = payment?.transactions.find(
      (transaction) => transaction.transactionExternalKey === transactionExternalKey,
    );
    if (already !== undefined) return already.status === 'SUCCESS';
    const created = await this.call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      amount: amountInRupees(amountPaise),
      currency: 'INR',
      transactionExternalKey,
    });
    if (created.status >= 400) return false;
    const after = await this.call('GET', `/1.0/kb/payments/${paymentId}`);
    const settled = after.json as KillBillPayment | null;
    const transaction = settled?.transactions.find(
      (entry) => entry.transactionExternalKey === transactionExternalKey,
    );
    return transaction?.status === 'SUCCESS';
  }
}
