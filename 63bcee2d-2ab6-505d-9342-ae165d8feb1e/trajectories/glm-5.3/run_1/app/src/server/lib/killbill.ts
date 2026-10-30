// Kill Bill client: find-or-create account, create one committed invoice with
// one external charge item, fetch the invoice, void an invoice.

import { centsToWireDecimal } from './money.js';

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export interface RaisedInvoice {
  killbillInvoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
}

export class KillBillUnavailable extends Error {}

export class KillBill {
  private auth: string;

  constructor(private config: KillBillConfig) {
    this.auth = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.auth,
      'X-Killbill-ApiKey': this.config.apiKey,
      'X-Killbill-ApiSecret': this.config.apiSecret,
      'X-Killbill-CreatedBy': 'plumbline',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}${path}`, {
        ...init,
        headers: { ...this.headers(), ...((init.headers as Record<string, string>) || {}) },
      });
    } catch {
      throw new KillBillUnavailable();
    }
    if (response.status >= 500) throw new KillBillUnavailable();
    return response;
  }

  /** Find the account by external key; returns null when absent. */
  async findAccount(externalKey: string): Promise<{ accountId: string; currency: string } | null> {
    const response = await this.request(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new KillBillUnavailable();
    const account = (await response.json()) as { accountId: string; currency: string };
    return { accountId: account.accountId, currency: account.currency };
  }

  /** Create the account for a project. */
  async createAccount(externalKey: string, name: string, currency: string): Promise<string> {
    const response = await this.request('/1.0/kb/accounts', {
      method: 'POST',
      body: JSON.stringify({ name, externalKey, currency }),
    });
    if (!response.ok && response.status !== 201) throw new KillBillUnavailable();
    let accountId: string | undefined;
    const location = response.headers.get('Location');
    if (location) {
      accountId = location.split('/').filter(Boolean).pop();
    }
    if (!accountId) {
      const found = await this.findAccount(externalKey);
      if (!found) throw new KillBillUnavailable();
      accountId = found.accountId;
    }
    return accountId;
  }

  /** Raise one committed invoice with one external charge for the stage fee. */
  async raiseStageInvoice(accountId: string, description: string, amountCents: number, currency: string): Promise<RaisedInvoice> {
    const bodyJson = `[{"accountId":"${accountId}","description":${JSON.stringify(description)},"amount":${centsToWireDecimal(amountCents)},"currency":"${currency}","quantity":1}]`;
    const response = await this.request(
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
      { method: 'POST', body: bodyJson },
    );
    if (!response.ok) throw new KillBillUnavailable();
    const items = (await response.json()) as { invoiceId: string }[];
    const item = items[0];
    if (!item?.invoiceId) throw new KillBillUnavailable();
    const invoice = await this.getInvoice(item.invoiceId);
    return {
      killbillInvoiceId: invoice.invoiceId,
      invoiceNumber: String(invoice.invoiceNumber),
      amountCents,
      currency,
    };
  }

  async getInvoice(invoiceId: string): Promise<{ invoiceId: string; invoiceNumber: string | number; amount: number; currency: string }> {
    const response = await this.request(`/1.0/kb/invoices/${invoiceId}`);
    if (!response.ok) throw new KillBillUnavailable();
    return (await response.json()) as { invoiceId: string; invoiceNumber: string | number; amount: number; currency: string };
  }

  /** Void an invoice (compensation when recording failed after the invoice was raised). */
  async voidInvoice(invoiceId: string): Promise<void> {
    try {
      await this.request(`/1.0/kb/invoices/${invoiceId}/voidInvoice`, { method: 'PUT' });
    } catch {
      // best effort only
    }
  }

  /** Check that the account's invoice list contains the expected invoice. */
  async listInvoices(accountId: string): Promise<{ invoiceId: string; invoiceNumber: string; amount: number; currency: string }[]> {
    const response = await this.request(`/1.0/kb/accounts/${accountId}/invoices`);
    if (!response.ok) throw new KillBillUnavailable();
    const invoices = (await response.json()) as { invoiceId: string; invoiceNumber: string | number; amount: number; currency: string }[];
    return invoices.map((i) => ({ invoiceId: i.invoiceId, invoiceNumber: String(i.invoiceNumber), amount: i.amount, currency: i.currency }));
  }
}
