import { cadencePlanName } from '../../shared/catalog.js';
import { formatCents } from '../../shared/money.js';
import { TIME_ZONE } from '../../shared/toronto.js';
import type { Cadence, Locale } from '../../shared/types.js';
import { config, LIMITS } from '../config.js';

export class BillingUnavailableError extends Error {
  constructor(detail: string) {
    super(`kill bill unavailable: ${detail}`);
  }
}

function reportOutage(error: BillingUnavailableError): BillingUnavailableError {
  process.stderr.write(`${error.message}\n`);
  return error;
}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const AUTO_INVOICING_DRAFT_TAG = '00000000-0000-0000-0000-000000000008';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const INVOICE_PAYMENT_CONTROL_PLUGIN = '__INVOICE_PAYMENT_CONTROL_PLUGIN__';
const BLOCKING_SERVICE = 'loafline';

export type KillBillInvoiceItem = {
  invoiceItemId: string;
  invoiceId: string;
  itemType: string;
  description: string;
  amount: number;
  subscriptionId: string | null;
};

export type KillBillInvoice = {
  invoiceId: string;
  invoiceDate: string;
  status: string;
  amount: number;
  balance: number;
  items: KillBillInvoiceItem[];
};

export type KillBillTransaction = {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amount: number;
  effectiveDate: string;
  status: string;
};

export type KillBillPayment = {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KillBillTransaction[];
};

export type TaxCharge = { description: string; amountCents: number };

export type ItemAdjustment = { invoiceItemId: string; amountCents: number };

type RequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  xml?: string;
  actor: string;
  /** A missing record is an answer, not an outage. */
  absentIsOk?: boolean;
};

type KillBillResponse = { status: number; location: string | null; text: string };

function headers(actor: string, contentType: string | null): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  const out: Record<string, string> = {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': actor,
    Accept: 'application/json',
  };
  if (contentType) out['Content-Type'] = contentType;
  return out;
}

async function call(options: RequestOptions): Promise<KillBillResponse> {
  const url = new URL(`${config.killbill.url}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const hasXml = options.xml !== undefined;
  let response: Response;
  try {
    const init: RequestInit = {
      method: options.method,
      headers: headers(
        options.actor,
        hasXml ? 'text/xml' : options.body === undefined ? null : 'application/json',
      ),
      signal: AbortSignal.timeout(LIMITS.killbillTimeoutMs),
    };
    if (hasXml) init.body = options.xml as string;
    else if (options.body !== undefined) init.body = JSON.stringify(options.body);
    response = await fetch(url, init);
  } catch (error) {
    throw reportOutage(
      new BillingUnavailableError(error instanceof Error ? error.message : 'no answer'),
    );
  }
  const text = await response.text().catch(() => '');
  if (response.status === 404 && options.absentIsOk === true) {
    return { status: 404, location: null, text: '' };
  }
  if (response.status >= 400) {
    throw reportOutage(
      new BillingUnavailableError(
        `${options.method} ${options.path} -> ${response.status} ${text.slice(0, 200)}`,
      ),
    );
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

function parse<T>(response: KillBillResponse): T {
  if (response.text === '') throw new BillingUnavailableError('empty body');
  return JSON.parse(response.text) as T;
}

function idFromLocation(response: KillBillResponse): string {
  const location = response.location;
  if (!location) throw new BillingUnavailableError('no Location header');
  const parts = location.replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  if (!id) throw new BillingUnavailableError('empty Location header');
  return id;
}

function dollars(cents: number): number {
  return Number(formatCents(cents));
}

export function killbillAmountToCents(amount: number): number {
  return Math.round(amount * 100);
}

const CATALOG_XML = buildCatalogXml();

function buildCatalogXml(): string {
  const plans = (['MONTHLY', 'BIMESTRIAL', 'QUARTERLY'] as const)
    .map(
      (period) => `
    <plan name="${cadencePlanName(period)}">
      <product>trio</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>${period}</billingPeriod>
          <recurringPrice><price><currency>CAD</currency><value>29.04</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`,
    )
    .join('');
  const references = (['MONTHLY', 'BIMESTRIAL', 'QUARTERLY'] as const)
    .map((period) => `<plan>${cadencePlanName(period)}</plan>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Loafline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CAD</currency></currencies>
  <products>
    <product name="trio"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${plans}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans>${references}</plans></defaultPriceList>
  </priceLists>
</catalog>
`;
}

export const SYSTEM_ACTOR = 'loafline';

type CatalogVersion = {
  products: { name: string; plans: { name: string; phases: { prices: { currency: string; value: number }[] }[] }[] }[];
};

const TRIO_PRICE = 29.04;

function catalogHasTrio(versions: readonly CatalogVersion[]): boolean {
  const wanted = (['MONTHLY', 'BIMESTRIAL', 'QUARTERLY'] as const).map(cadencePlanName);
  return versions.some((version) =>
    version.products.some(
      (product) =>
        product.name === 'trio' &&
        wanted.every((planName) =>
          product.plans.some(
            (plan) =>
              plan.name === planName &&
              plan.phases.some((phase) =>
                phase.prices.some((price) => price.currency === 'CAD' && price.value === TRIO_PRICE),
              ),
          ),
        ),
    ),
  );
}

export const killbill = {
  /** Reading the tenant catalog is also the cheapest proof that Kill Bill answers. */
  async readCatalog(): Promise<CatalogVersion[]> {
    const response = await call({ method: 'GET', path: '/1.0/kb/catalog', actor: SYSTEM_ACTOR });
    return parse<CatalogVersion[]>(response);
  },

  /** Kill Bill refuses a repeat upload of the same version, so it only runs when the trio is absent. */
  async ensureCatalog(): Promise<void> {
    const versions = await this.readCatalog();
    if (catalogHasTrio(versions)) return;
    await call({ method: 'POST', path: '/1.0/kb/catalog/xml', xml: CATALOG_XML, actor: SYSTEM_ACTOR });
  },

  async findAccountId(email: string): Promise<string | null> {
    const response = await call({
      method: 'GET',
      path: '/1.0/kb/accounts',
      query: { externalKey: email },
      actor: SYSTEM_ACTOR,
      absentIsOk: true,
    });
    if (response.text === '') return null;
    const account = parse<{ accountId?: string }>(response);
    return account.accountId ?? null;
  },

  async createAccount(input: {
    email: string;
    name: string;
    locale: Locale;
    actor: string;
  }): Promise<string> {
    const created = await call({
      method: 'POST',
      path: '/1.0/kb/accounts',
      body: {
        name: input.name,
        externalKey: input.email,
        email: input.email,
        currency: 'CAD',
        timeZone: TIME_ZONE,
        locale: input.locale === 'fr-CA' ? 'fr_CA' : 'en_CA',
      },
      actor: input.actor,
    });
    const accountId = idFromLocation(created);
    await call({
      method: 'POST',
      path: `/1.0/kb/accounts/${accountId}/paymentMethods`,
      query: { isDefault: 'true' },
      body: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
      actor: input.actor,
    });
    // The app owns every payment key and adds its own tax items, so Kill Bill must neither pay nor
    // commit invoices by itself.
    await call({
      method: 'POST',
      path: `/1.0/kb/accounts/${accountId}/tags`,
      body: [AUTO_PAY_OFF_TAG, AUTO_INVOICING_DRAFT_TAG],
      actor: input.actor,
    });
    return accountId;
  },

  async createDraftCharges(
    accountId: string,
    charges: readonly TaxCharge[],
    actor: string,
  ): Promise<{ invoiceId: string; items: KillBillInvoiceItem[] }> {
    const response = await call({
      method: 'POST',
      path: `/1.0/kb/invoices/charges/${accountId}`,
      query: { autoCommit: 'false' },
      body: charges.map((charge) => ({
        accountId,
        amount: dollars(charge.amountCents),
        currency: 'CAD',
        description: charge.description,
      })),
      actor,
    });
    const items = parse<KillBillInvoiceItem[]>(response);
    const first = items[0];
    if (!first) throw new BillingUnavailableError('no invoice items created');
    return { invoiceId: first.invoiceId, items };
  },

  async addTaxItems(
    accountId: string,
    invoiceId: string,
    taxes: readonly TaxCharge[],
    actor: string,
  ): Promise<KillBillInvoiceItem[]> {
    if (taxes.length === 0) return [];
    const response = await call({
      method: 'POST',
      path: `/1.0/kb/invoices/taxes/${accountId}`,
      query: { autoCommit: 'false' },
      body: taxes.map((tax) => ({
        accountId,
        invoiceId,
        amount: dollars(tax.amountCents),
        currency: 'CAD',
        description: tax.description,
      })),
      actor,
    });
    return parse<KillBillInvoiceItem[]>(response);
  },

  async commitInvoice(invoiceId: string, actor: string): Promise<void> {
    await call({ method: 'PUT', path: `/1.0/kb/invoices/${invoiceId}/commitInvoice`, actor });
  },

  async getInvoice(invoiceId: string, actor: string): Promise<KillBillInvoice> {
    const response = await call({
      method: 'GET',
      path: `/1.0/kb/invoices/${invoiceId}`,
      query: { withItems: 'true' },
      actor,
    });
    return parse<KillBillInvoice>(response);
  },

  async payInvoice(input: {
    accountId: string;
    invoiceId: string;
    amountCents: number;
    externalKey: string;
    actor: string;
  }): Promise<string> {
    const response = await call({
      method: 'POST',
      path: `/1.0/kb/accounts/${input.accountId}/payments`,
      query: {
        controlPluginName: INVOICE_PAYMENT_CONTROL_PLUGIN,
        pluginProperty: `IPCD_INVOICE_ID=${input.invoiceId}`,
      },
      body: {
        transactionType: 'PURCHASE',
        amount: dollars(input.amountCents),
        currency: 'CAD',
        paymentExternalKey: input.externalKey,
        transactionExternalKey: input.externalKey,
      },
      actor: input.actor,
    });
    return idFromLocation(response);
  },

  async refundWithItemAdjustments(input: {
    paymentId: string;
    amountCents: number;
    adjustments: readonly ItemAdjustment[];
    actor: string;
  }): Promise<string> {
    await call({
      method: 'POST',
      path: `/1.0/kb/invoicePayments/${input.paymentId}/refunds`,
      body: {
        paymentId: input.paymentId,
        amount: dollars(input.amountCents),
        currency: 'CAD',
        isAdjusted: input.adjustments.length > 0,
        adjustments: input.adjustments.map((adjustment) => ({
          invoiceItemId: adjustment.invoiceItemId,
          amount: dollars(adjustment.amountCents),
        })),
      },
      actor: input.actor,
    });
    const payment = await this.getPayment(input.paymentId, input.actor);
    const refunds = payment.transactions.filter((item) => item.transactionType === 'REFUND');
    const latest = refunds[refunds.length - 1];
    if (!latest) throw new BillingUnavailableError('refund transaction missing');
    return latest.transactionId;
  },

  async getPayment(paymentId: string, actor: string): Promise<KillBillPayment> {
    const response = await call({
      method: 'GET',
      path: `/1.0/kb/payments/${paymentId}`,
      query: { withPluginInfo: 'false' },
      actor,
    });
    return parse<KillBillPayment>(response);
  },

  async accountPayments(accountId: string, actor: string): Promise<KillBillPayment[]> {
    const response = await call({
      method: 'GET',
      path: `/1.0/kb/accounts/${accountId}/payments`,
      actor,
    });
    return parse<KillBillPayment[]>(response);
  },

  async addAccountCredit(input: {
    accountId: string;
    amountCents: number;
    description: string;
    actor: string;
  }): Promise<string> {
    const response = await call({
      method: 'POST',
      path: '/1.0/kb/credits',
      query: { autoCommit: 'true' },
      body: [
        {
          accountId: input.accountId,
          amount: dollars(input.amountCents),
          currency: 'CAD',
          description: input.description,
        },
      ],
      actor: input.actor,
    });
    const items = parse<KillBillInvoiceItem[]>(response);
    const first = items[0];
    if (!first) throw new BillingUnavailableError('no credit item created');
    return first.invoiceItemId;
  },

  async createSubscription(input: {
    accountId: string;
    externalKey: string;
    cadence: Cadence;
    actor: string;
  }): Promise<string> {
    const response = await call({
      method: 'POST',
      path: '/1.0/kb/subscriptions',
      body: {
        accountId: input.accountId,
        externalKey: input.externalKey,
        planName: cadencePlanName(input.cadence),
      },
      actor: input.actor,
    });
    return idFromLocation(response);
  },

  async accountInvoices(accountId: string, actor: string): Promise<KillBillInvoice[]> {
    const response = await call({
      method: 'GET',
      path: `/1.0/kb/accounts/${accountId}/invoices`,
      query: { withItems: 'true', includeInvoiceComponents: 'true' },
      actor,
    });
    return parse<KillBillInvoice[]>(response);
  },

  async blockSubscription(input: {
    subscriptionId: string;
    stateName: 'TRIO_SKIP' | 'TRIO_PAUSE' | 'TRIO_CLEAR';
    effectiveAt: Date;
    actor: string;
  }): Promise<void> {
    await call({
      method: 'POST',
      path: `/1.0/kb/subscriptions/${input.subscriptionId}/block`,
      query: { requestedDate: input.effectiveAt.toISOString() },
      body: {
        stateName: input.stateName,
        service: BLOCKING_SERVICE,
        isBlockBilling: input.stateName !== 'TRIO_CLEAR',
        isBlockEntitlement: false,
        isBlockChange: false,
      },
      actor: input.actor,
    });
  },

  async changePlan(input: {
    subscriptionId: string;
    cadence: Cadence;
    requestedDate: string;
    actor: string;
  }): Promise<void> {
    await call({
      method: 'PUT',
      path: `/1.0/kb/subscriptions/${input.subscriptionId}`,
      query: { requestedDate: input.requestedDate },
      body: { planName: cadencePlanName(input.cadence) },
      actor: input.actor,
    });
  },

  async undoChangePlan(subscriptionId: string, actor: string): Promise<void> {
    await call({
      method: 'PUT',
      path: `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`,
      actor,
    });
  },

  async cancelSubscription(input: {
    subscriptionId: string;
    requestedDate: string;
    actor: string;
  }): Promise<void> {
    await call({
      method: 'DELETE',
      path: `/1.0/kb/subscriptions/${input.subscriptionId}`,
      query: { requestedDate: input.requestedDate, useRequestedDateForBilling: 'true' },
      actor: input.actor,
    });
  },
};
