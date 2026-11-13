// Kill Bill is the only billing record. All figures shown, stored or emailed
// are read back from it, never kept from the desk's own arithmetic.
import type { DeskConfig } from '../config.js';

export class BillingUnavailable extends Error {
  constructor() { super('billing_unavailable'); this.name = 'BillingUnavailable'; }
}

export interface InvoiceView {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amountMinor: number;
  balanceMinor: number;
  items: ReadonlyArray<{ description: string; amountMinor: number }>;
}

export interface PaymentView {
  paymentId: string;
  purchasedMinor: number;
  refundMinor: number;
  purchaseTransactionId: string | null;
  refundTransactionId: string | null;
}

/** Convert decimal pounds in a Kill Bill response into integer pence. */
function poundsToMinor(value: number): number {
  return Math.round(value * 100);
}

export class KillBillClient {
  constructor(private readonly config: DeskConfig) {}

  private headers(): Record<string, string> {
    const auth = Buffer.from(`${this.config.killbill.username}:${this.config.killbill.password}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'X-Killbill-ApiKey': this.config.killbill.apiKey,
      'X-Killbill-ApiSecret': this.config.killbill.apiSecret,
      'X-Killbill-CreatedBy': 'fittings-desk',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown, opts?: { expect?: number }): Promise<Response> {
    const url = `${this.config.killbill.url}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return res;
    } catch {
      throw new BillingUnavailable();
    }
  }

  async ensureAccount(reference: string): Promise<string> {
    const byKey = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(reference)}`);
    if (byKey.status === 200) {
      const json = (await byKey.json()) as { accountId: string };
      return json.accountId;
    }
    if (byKey.status !== 404) throw new BillingUnavailable();
    const created = await this.request('POST', '/1.0/kb/accounts', {
      name: reference, externalKey: reference, currency: 'GBP',
    });
    if (created.status !== 201) throw new BillingUnavailable();
    const location = created.headers.get('Location');
    if (!location) throw new BillingUnavailable();
    const id = location.substring(location.lastIndexOf('/') + 1);
    return id;
  }

  /** Create one committed invoice with the two external charge items. */
  async createInvoice(reference: string, accountId: string, partLineMinor: number, partDescription: string, carriageMinor: number, carriageDescription: string): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const body = [
      { accountId, itemType: 'EXTERNAL_CHARGE', description: partDescription, amount: partLineMinor / 100, currency: 'GBP', quantity: 1 },
      { accountId, itemType: 'EXTERNAL_CHARGE', description: carriageDescription, amount: carriageMinor / 100, currency: 'GBP', quantity: 1 },
    ];
    const res = await this.request('POST', `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}?autoCommit=true`, body);
    if (res.status !== 200 && res.status !== 201) throw new BillingUnavailable();
    const items = (await res.json()) as Array<{ invoiceId: string }>;
    const invoiceId = items[0]?.invoiceId;
    if (!invoiceId) throw new BillingUnavailable();
    const invoice = await this.readInvoice(invoiceId);
    return { invoiceId, invoiceNumber: invoice.invoiceNumber };
  }

  async readInvoice(invoiceId: string): Promise<InvoiceView> {
    const res = await this.request('GET', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}`);
    if (res.status !== 200) throw new BillingUnavailable();
    const json = (await res.json()) as {
      invoiceId: string; invoiceNumber: string; status: string; amount: number; balance: number;
      items: ReadonlyArray<{ description: string | null; amount: number }>;
    };
    return {
      invoiceId: json.invoiceId,
      invoiceNumber: json.invoiceNumber,
      status: json.status,
      amountMinor: poundsToMinor(json.amount),
      balanceMinor: poundsToMinor(json.balance),
      items: json.items.map((i) => ({ description: i.description ?? '', amountMinor: poundsToMinor(i.amount) })),
    };
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const res = await this.request('PUT', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/voidInvoice`);
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw new BillingUnavailable();
  }

  async recordPayment(accountId: string, invoiceId: string, totalMinor: number): Promise<PaymentView> {
    const body = {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: totalMinor / 100,
      currency: 'GBP',
    };
    const res = await this.request('POST', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/payments?externalPayment=true`, body);
    if (res.status !== 200 && res.status !== 201) throw new BillingUnavailable();
    // Kill Bill answers 201 with an empty body here; read the payment back.
    const paymentId = await this.paymentIdForInvoice(invoiceId);
    return this.readPayment(paymentId);
  }

  /** The payment Kill Bill holds against an invoice, read back after the fact. */
  async paymentIdForInvoice(invoiceId: string): Promise<string> {
    const res = await this.request('GET', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/payments`);
    if (res.status !== 200) throw new BillingUnavailable();
    const list = (await res.json()) as ReadonlyArray<{ paymentId: string }>;
    const last = list[list.length - 1];
    if (last === undefined) throw new BillingUnavailable();
    return last.paymentId;
  }

  async readPayment(paymentId: string): Promise<PaymentView> {
    const res = await this.request('GET', `/1.0/kb/payments/${encodeURIComponent(paymentId)}`);
    if (res.status !== 200) throw new BillingUnavailable();
    const json = (await res.json()) as {
      paymentId: string; purchasedAmount: number; refundedAmount: number;
      transactions?: ReadonlyArray<{ transactionId: string; transactionType: string; status: string }>;
    };
    const txs = json.transactions ?? [];
    const purchase = txs.find((t) => t.transactionType === 'PURCHASE');
    const refund = txs.find((t) => t.transactionType === 'REFUND');
    return {
      paymentId: json.paymentId,
      purchasedMinor: poundsToMinor(json.purchasedAmount),
      refundMinor: poundsToMinor(json.refundedAmount),
      purchaseTransactionId: purchase ? purchase.transactionId : null,
      refundTransactionId: refund ? refund.transactionId : null,
    };
  }

  async refundPayment(paymentId: string, amountMinor: number): Promise<PaymentView> {
    const body = { transactionType: 'REFUND', amount: amountMinor / 100, currency: 'GBP' };
    const res = await this.request('POST', `/1.0/kb/invoicePayments/${encodeURIComponent(paymentId)}/refunds`, body);
    if (res.status !== 200 && res.status !== 201) throw new BillingUnavailable();
    return this.readPayment(paymentId);
  }

  /** The account balance Kill Bill reports, in minor units. */
  async accountBalanceMinor(accountId: string): Promise<number> {
    const res = await this.request('GET', `/1.0/kb/accounts/${encodeURIComponent(accountId)}?accountWithBalance=true&accountWithBalanceAndCBA=true`);
    if (res.status !== 200) throw new BillingUnavailable();
    const json = (await res.json()) as { accountBalance: number | null };
    return json.accountBalance === null ? 0 : poundsToMinor(json.accountBalance);
  }

  async accountExists(reference: string): Promise<boolean> {
    const res = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(reference)}`);
    return res.status === 200;
  }
}
