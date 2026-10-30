import type { KillBillConfig } from '../config.js';
import { formatMoney } from '../../shared/format.js';

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('billing_unavailable');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

const REQUEST_TIMEOUT_MS = 8000;

interface KillBillInvoiceItem {
  itemType: string;
  description: string | null;
  amount: number;
}

interface KillBillInvoice {
  invoiceId: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items: KillBillInvoiceItem[] | null;
}

export interface AccountDetails {
  memberId: string;
  businessName: string;
  contactEmail: string;
}

export interface InvoiceView {
  id: string;
  date: string;
  amount: string;
  balance: string;
  items: Array<{ description: string; amount: string }>;
}

function centsToAmount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * Kill Bill holds every member's billing account, charges, payments and
 * credits. Any transport failure or 5xx surfaces as BillingUnavailable so the
 * caller can queue the work.
 */
export class KillBillClient {
  readonly #config: KillBillConfig;

  constructor(config: KillBillConfig) {
    this.#config = config;
  }

  #headers(): Record<string, string> {
    const basic = Buffer.from(`${this.#config.username}:${this.#config.password}`).toString('base64');
    return {
      authorization: `Basic ${basic}`,
      'x-killbill-apikey': this.#config.apiKey,
      'x-killbill-apisecret': this.#config.apiSecret,
      'x-killbill-createdby': 'passboard',
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  async #request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; location: string | null; json: unknown }> {
    let response: Response;
    try {
      response = await fetch(`${this.#config.url}${path}`, {
        method,
        headers: this.#headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BillingUnavailable(error);
    }
    if (response.status >= 500) {
      throw new BillingUnavailable(new Error(`${method} ${path} answered ${response.status}`));
    }
    const text = await response.text();
    let json: unknown = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, location: response.headers.get('location'), json };
  }

  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.#config.url}/1.0/healthcheck`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Reuses an account already carrying the member id as its external key. */
  async ensureAccount(details: AccountDetails): Promise<string> {
    const existing = await this.#request(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(details.memberId)}`,
    );
    if (existing.status === 200 && existing.json !== null) {
      const accountId = (existing.json as { accountId?: string }).accountId;
      if (typeof accountId === 'string') return accountId;
    }
    const created = await this.#request('POST', '/1.0/kb/accounts', {
      externalKey: details.memberId,
      name: details.businessName,
      email: details.contactEmail,
      currency: 'USD',
    });
    const location = created.location;
    if (created.status === 201 && location !== null) {
      return location.slice(location.lastIndexOf('/') + 1);
    }
    // A concurrent copy of the app may have created it between the two calls.
    const retry = await this.#request(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(details.memberId)}`,
    );
    const accountId = (retry.json as { accountId?: string } | null)?.accountId;
    if (typeof accountId === 'string') return accountId;
    throw new BillingUnavailable(new Error('account could not be created'));
  }

  /** An external charge, returning the invoice it landed on. */
  async addExternalCharge(
    accountId: string,
    description: string,
    amountCents: number,
  ): Promise<string> {
    const result = await this.#request(
      'POST',
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
      [
        {
          accountId,
          amount: centsToAmount(amountCents),
          currency: 'USD',
          description,
        },
      ],
    );
    if (result.status !== 200 && result.status !== 201) {
      throw new BillingUnavailable(new Error(`charge answered ${result.status}`));
    }
    const items = result.json as Array<{ invoiceId?: string }> | null;
    const invoiceId = items?.[0]?.invoiceId;
    if (typeof invoiceId !== 'string') {
      throw new BillingUnavailable(new Error('charge returned no invoice'));
    }
    return invoiceId;
  }

  async payInvoice(accountId: string, invoiceId: string, amountCents: number): Promise<void> {
    const result = await this.#request(
      'POST',
      `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
      { accountId, purchasedAmount: centsToAmount(amountCents) },
    );
    if (result.status !== 200 && result.status !== 201 && result.status !== 204) {
      throw new BillingUnavailable(new Error(`payment answered ${result.status}`));
    }
  }

  async addCredit(accountId: string, description: string, amountCents: number): Promise<void> {
    const result = await this.#request('POST', '/1.0/kb/credits?autoCommit=true', [
      {
        accountId,
        amount: centsToAmount(amountCents),
        currency: 'USD',
        description,
      },
    ]);
    if (result.status !== 200 && result.status !== 201) {
      throw new BillingUnavailable(new Error(`credit answered ${result.status}`));
    }
  }

  /**
   * The account-scoped list omits items and totals on this server, so each
   * invoice is read back individually.
   */
  async listInvoices(accountId: string): Promise<InvoiceView[]> {
    const listed = await this.#request('GET', `/1.0/kb/accounts/${accountId}/invoices`);
    if (listed.status !== 200) {
      throw new BillingUnavailable(new Error(`invoice list answered ${listed.status}`));
    }
    const stubs = (listed.json as Array<{ invoiceId: string }> | null) ?? [];
    const invoices: InvoiceView[] = [];
    for (const stub of stubs) {
      const detail = await this.#request(
        'GET',
        `/1.0/kb/invoices/${stub.invoiceId}?withItems=true`,
      );
      if (detail.status !== 200 || detail.json === null) continue;
      const invoice = detail.json as KillBillInvoice;
      const items = (invoice.items ?? []).map((item) => ({
        description: item.description ?? item.itemType,
        amount: formatMoney(Math.round(item.amount * 100)),
      }));
      if (items.length === 0) continue;
      invoices.push({
        id: invoice.invoiceId,
        date: invoice.invoiceDate,
        amount: formatMoney(Math.round(invoice.amount * 100)),
        balance: formatMoney(Math.round(invoice.balance * 100)),
        items,
      });
    }
    return invoices;
  }
}
