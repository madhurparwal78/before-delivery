import type { Config } from '../config.ts';

const CALL_TIMEOUT_MS = 8000;
const CHECK_TIMEOUT_MS = 3000;

export type ChargeItem = { amount: string; description: string };

export type ProviderInvoice = {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  balanceCents: number;
};

type KillBillInvoice = {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  balance: number;
  items?: { description: string | null }[];
};

/** Raised when a reply never arrived, so the call may or may not have been applied. */
export class AmbiguousBillingReply extends Error {}

function centsOf(amount: number): number {
  return Math.round(amount * 100);
}

export class BillingProvider {
  private readonly settings: Config['killbill'];

  constructor(settings: Config['killbill']) {
    this.settings = settings;
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.settings.username}:${this.settings.password}`).toString('base64');
    return {
      authorization: `Basic ${basic}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-killbill-apikey': this.settings.apiKey,
      'x-killbill-apisecret': this.settings.apiSecret,
      'x-killbill-createdby': 'slackwater',
    };
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    timeout = CALL_TIMEOUT_MS,
  ): Promise<Response> {
    try {
      return await fetch(`${this.settings.url}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (cause) {
      throw new AmbiguousBillingReply(`billing provider gave no reply for ${method} ${path}`, {
        cause,
      });
    }
  }

  async check(): Promise<boolean> {
    try {
      const response = await fetch(`${this.settings.url}/1.0/healthcheck`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Accounts are looked up by external key and reused, so instances can share one tenant. */
  async accountIdFor(externalKey: string, name: string): Promise<string> {
    const found = await this.call(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    );
    if (found.ok) {
      const account = (await found.json()) as { accountId: string };
      return account.accountId;
    }
    if (found.status !== 404) throw new Error(`billing account lookup failed: ${found.status}`);
    const created = await this.call('POST', '/1.0/kb/accounts', {
      externalKey,
      name,
      currency: 'CAD',
    });
    if (created.status === 201) {
      const location = created.headers.get('location');
      if (location !== null) return location.slice(location.lastIndexOf('/') + 1);
    }
    if (created.status !== 201 && created.status !== 409) {
      throw new Error(`billing account creation failed: ${created.status}`);
    }
    const retry = await this.call(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    );
    if (!retry.ok) throw new Error(`billing account lookup failed: ${retry.status}`);
    const account = (await retry.json()) as { accountId: string };
    return account.accountId;
  }

  /** One DRAFT invoice with one EXTERNAL_CHARGE item per line, in line order. */
  async postExternalCharges(accountId: string, items: readonly ChargeItem[]): Promise<string> {
    const response = await this.call(
      'POST',
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
      items.map((item) => ({
        accountId,
        amount: item.amount,
        currency: 'CAD',
        description: item.description,
      })),
    );
    if (!response.ok) throw new Error(`billing charge posting failed: ${response.status}`);
    const posted = (await response.json()) as { invoiceId: string }[];
    const first = posted[0];
    if (first === undefined) throw new Error('billing provider returned no invoice items');
    return first.invoiceId;
  }

  /** Reads the account's draft invoices back, so an adopted attempt leaves no second draft. */
  async draftInvoiceHolding(accountId: string, descriptions: readonly string[]): Promise<string | null> {
    const response = await this.call(
      'GET',
      `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`,
    );
    if (!response.ok) throw new Error(`billing invoice listing failed: ${response.status}`);
    const invoices = (await response.json()) as KillBillInvoice[];
    for (const invoice of invoices) {
      if (invoice.status !== 'DRAFT') continue;
      const held = (invoice.items ?? []).map((item) => item.description ?? '');
      if (descriptions.every((description) => held.includes(description))) return invoice.invoiceId;
    }
    return null;
  }

  async commitInvoice(invoiceId: string): Promise<void> {
    const response = await this.call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
    if (!response.ok && response.status !== 400) {
      throw new Error(`billing invoice commit failed: ${response.status}`);
    }
  }

  async readInvoice(invoiceId: string): Promise<ProviderInvoice> {
    const response = await this.call('GET', `/1.0/kb/invoices/${invoiceId}`);
    if (!response.ok) throw new Error(`billing invoice read failed: ${response.status}`);
    const invoice = (await response.json()) as KillBillInvoice;
    return {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      balanceCents: centsOf(invoice.balance),
    };
  }
}
