import { Config } from '../config.js';

// Kill Bill REST client for the three flows the app needs: account creation,
// an external-charge invoice committed and paid by a PURCHASE transaction, and
// a REFUND transaction keyed to that payment. Every call connects fresh, so a
// down Kill Bill fails as billing_unavailable and later calls succeed.

export class BillingDown extends Error {
  constructor() { super('billing_down'); }
}

export interface PaidInvoice {
  invoiceId: string;
  paymentId: string;
  paymentTransactionId: string;
}

interface KbAccount { accountId: string; externalKey: string }
interface KbChargeItem { invoiceId: string }
interface KbTransaction { transactionId: string; transactionType: string }
interface KbPayment { paymentId: string; transactions: KbTransaction[] }
interface KbInvoicePayment { targetInvoiceId: string }

interface KbResponse {
  status: number;
  json: unknown;
}

export class KillBill {
  constructor(private cfg: Config) {}

  private headers(): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.cfg.killbill.username}:${this.cfg.killbill.password}`).toString('base64'),
      'X-Killbill-ApiKey': this.cfg.killbill.apiKey,
      'X-Killbill-ApiSecret': this.cfg.killbill.apiSecret,
      'X-Killbill-CreatedBy': 'stationhouse',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async call(method: string, path: string, body?: unknown, allow404 = false): Promise<KbResponse> {
    let res: Response;
    try {
      res = await fetch(this.cfg.killbill.url + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new BillingDown();
    }
    if (res.status === 404 && allow404) return { status: 404, json: null };
    if (res.status >= 500) throw new BillingDown();
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try { json = JSON.parse(text); } catch {
        if (res.status >= 400) throw new BillingDown();
      }
    }
    return { status: res.status, json };
  }

  // Account with the app's external key, created on the tenant's first purchase.
  async ensureAccount(tenantId: string, businessName: string, email: string): Promise<string> {
    const key = `stationhouse-${tenantId}`;
    const list = await this.call('GET', `/1.0/kb/accounts/search/${encodeURIComponent(key)}`, undefined, true);
    if (list.status === 200 && Array.isArray(list.json)) {
      const hit = (list.json as KbAccount[]).find((a) => a.externalKey === key);
      if (hit) return hit.accountId;
    }
    const created = await this.call('POST', `/1.0/kb/accounts?externalKey=${encodeURIComponent(key)}`, {
      externalKey: key, name: businessName, email, currency: 'USD',
    });
    if (created.status >= 400) throw new BillingDown();
    const createdAccount = created.json as KbAccount | null;
    if (createdAccount?.accountId) return createdAccount.accountId;
    const again = await this.call('GET', `/1.0/kb/accounts/search/${encodeURIComponent(key)}`, undefined, true);
    if (again.status === 200 && Array.isArray(again.json)) {
      const hit = (again.json as KbAccount[]).find((a) => a.externalKey === key);
      if (hit) return hit.accountId;
    }
    throw new BillingDown();
  }

  // One committed invoice with one external charge item, then one PURCHASE
  // payment against the external payment method, leaving balance 0.00.
  async createPaidInvoice(accountId: string, description: string, amountDollars: string, attemptKey: string): Promise<PaidInvoice> {
    const charge = await this.call('POST', `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}?autoCommit=true`, [
      { description, quantity: 1, amount: Number(amountDollars), currency: 'USD' },
    ]);
    if (charge.status >= 400 || !Array.isArray(charge.json) || charge.json.length === 0) throw new BillingDown();
    const invoiceId = (charge.json as KbChargeItem[])[0].invoiceId;
    if (!invoiceId) throw new BillingDown();
    const paymentKey = `stationhouse-attempt-${attemptKey}`;
    const pay = await this.call('POST', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/payments?externalPayment=true`, {
      accountId: accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: Number(amountDollars),
      currency: 'USD',
      paymentExternalKey: paymentKey,
      transactions: [{ transactionType: 'PURCHASE', amount: Number(amountDollars), currency: 'USD', transactionExternalKey: paymentKey }],
    });
    if (pay.status >= 400) {
      // The invoice exists but the payment failed: void it so no charge is left behind.
      await this.call('PUT', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/voidInvoice`);
      throw new BillingDown();
    }
    const payment = await this.findPaymentByKey(paymentKey);
    if (payment === null) throw new BillingDown();
    return {
      invoiceId,
      paymentId: payment.paymentId,
      paymentTransactionId: payment.transactions.find((t) => t.transactionType === 'PURCHASE')?.transactionId ?? '',
    };
  }

  async findPaymentByKey(paymentKey: string): Promise<KbPayment | null> {
    const r = await this.call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentKey)}`, undefined, true);
    const json = r.json as KbPayment | null;
    if (r.status === 200 && json && typeof json === 'object' && typeof json.paymentId === 'string') {
      return { paymentId: json.paymentId, transactions: json.transactions ?? [] };
    }
    return null;
  }

  // The invoice a payment was made against, for finishing a purchase that
  // crashed after Kill Bill recorded the payment.
  async invoiceOfPayment(paymentId: string): Promise<string | null> {
    const r = await this.call('GET', `/1.0/kb/invoicePayments/${encodeURIComponent(paymentId)}`, undefined, true);
    const json = r.json as KbInvoicePayment | null;
    if (r.status === 200 && json && typeof json === 'object' && typeof json.targetInvoiceId === 'string') {
      return json.targetInvoiceId;
    }
    return null;
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    await this.call('PUT', `/1.0/kb/invoices/${encodeURIComponent(invoiceId)}/voidInvoice`);
  }

  // One REFUND transaction on the pack's PURCHASE payment, keyed so a retry
  // never refunds twice.
  async refundPayment(paymentId: string, amountDollars: string, externalKey: string): Promise<void> {
    const r = await this.call('POST', `/1.0/kb/payments/${encodeURIComponent(paymentId)}/refunds`, {
      amount: Number(amountDollars),
      currency: 'USD',
      transactionExternalKey: externalKey,
    });
    if (r.status === 201 || r.status === 200 || r.status === 204) return;
    throw new BillingDown();
  }
}
