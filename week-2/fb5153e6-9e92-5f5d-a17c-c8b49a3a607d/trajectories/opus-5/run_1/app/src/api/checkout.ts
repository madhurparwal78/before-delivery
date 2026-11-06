import type { RequestContext } from '../http/router.js';
import { json } from '../http/router.js';
import type { Reply } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import type { FieldError } from '../http/errors.js';
import type { ModelRecord } from '../db/models.js';
import { resolvePurchasableModel } from './access.js';
import { activePlanState } from '../db/plan.js';
import { plan } from '../domain/plans.js';
import type { LicenceType } from '../domain/money.js';
import {
  canUpgrade,
  chargeDescription,
  discountedPriceCents,
  isLicenceType,
  seatsFor,
  upgradeAmountCents,
} from '../domain/money.js';
import { isValidEmail } from '../domain/text.js';
import { isLocale } from '../shared/locale.js';
import type { Locale } from '../shared/locale.js';
import { newOrderRef, newToken } from '../domain/identifiers.js';
import {
  findOrderByReceiptToken,
  insertOrder,
  markUpgraded,
  netPaidInChain,
} from '../db/orders.js';
import type { OrderRecord } from '../db/orders.js';
import { claimCopy, attachCopyToOrder, releaseCopy } from '../db/editions.js';
import { withIdempotency } from '../db/idempotency.js';
import {
  buyerAccountKey,
  createExternalCharge,
  ensureAccount,
  payInvoice,
} from '../services/killbill.js';
import { sendReceiptEmail } from '../services/emails.js';

interface CheckoutBody {
  readonly model: string | null;
  readonly licence: unknown;
  readonly email: unknown;
  readonly terms: unknown;
  readonly locale: unknown;
  readonly access: string | null;
  readonly upgradeFrom: string | null;
}

const KNOWN_FIELDS = new Set([
  'model',
  'licence',
  'email',
  'terms',
  'locale',
  'access',
  'upgrade_from',
]);

function readBody(raw: Record<string, unknown>): CheckoutBody {
  const unknown = Object.keys(raw).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknown.length > 0) {
    throw validationFailed(unknown.map((name) => fieldError(name, 'unknown')));
  }
  return {
    model: typeof raw.model === 'string' ? raw.model : null,
    licence: raw.licence,
    email: raw.email,
    terms: raw.terms,
    locale: raw.locale,
    access: typeof raw.access === 'string' ? raw.access : null,
    upgradeFrom: typeof raw.upgrade_from === 'string' ? raw.upgrade_from : null,
  };
}

interface Priced {
  readonly amountCents: number;
  readonly editionNumber: number | null;
  readonly upgradeSource: OrderRecord | null;
}

/** Edition copies cost the edition price in force when the order is created. */
async function priceEdition(model: ModelRecord): Promise<Priced> {
  const state = await activePlanState();
  if (!plan(state.plan).editions) throw new ApiError('edition_unavailable');
  if (model.editionTotal === null || model.editionPriceCents === null) {
    throw new ApiError('edition_unavailable');
  }
  const number = await claimCopy(model.id, model.editionTotal);
  if (number === null) throw new ApiError('edition_sold_out');
  return { amountCents: model.editionPriceCents, editionNumber: number, upgradeSource: null };
}

function listPriceFor(model: ModelRecord, licence: LicenceType): number | null {
  switch (licence) {
    case 'personal':
      return model.personalCents;
    case 'commercial':
      return model.commercialCents;
    case 'studio':
      return model.studioCents;
    case 'edition':
      return model.editionPriceCents;
  }
}

async function priceUpgrade(
  model: ModelRecord,
  licence: LicenceType,
  source: OrderRecord,
): Promise<Priced> {
  if (!canUpgrade(source.licence, licence)) throw new ApiError('upgrade_not_possible');
  if (source.upgradedTo !== null) throw new ApiError('upgrade_not_possible');
  if (source.status === 'refunded') throw new ApiError('upgrade_not_possible');
  const list = listPriceFor(model, licence);
  if (list === null) throw new ApiError('upgrade_not_possible');
  const target = discountedPriceCents(list, model.discountPercent);
  const amount = upgradeAmountCents(target, await netPaidInChain(source.id));
  if (amount <= 0) throw new ApiError('upgrade_not_possible');
  return { amountCents: amount, editionNumber: null, upgradeSource: source };
}

async function priceLicence(model: ModelRecord, licence: LicenceType): Promise<Priced> {
  const list = listPriceFor(model, licence);
  if (list === null) throw notFound();
  return {
    amountCents: discountedPriceCents(list, model.discountPercent),
    editionNumber: null,
    upgradeSource: null,
  };
}

function validateFields(body: CheckoutBody): { email: string; locale: Locale } {
  const errors: FieldError[] = [];
  if (!isLicenceType(body.licence)) errors.push(fieldError('licence', 'choose_one'));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!isValidEmail(email)) errors.push(fieldError('email', 'email'));
  if (body.terms !== true) errors.push(fieldError('terms', 'terms'));
  if (body.locale !== undefined && !isLocale(body.locale)) {
    errors.push(fieldError('locale', 'choose_one'));
  }
  if (errors.length > 0) throw validationFailed(errors);
  return { email, locale: isLocale(body.locale) ? body.locale : 'en' };
}

async function runCheckout(ctx: RequestContext): Promise<Reply> {
  const body = readBody(ctx.body);
  if (body.model === null) throw notFound();

  const model = await resolvePurchasableModel(ctx, body.model, body.access);
  if (model.readOnly) throw notFound();

  const source =
    body.upgradeFrom === null ? null : await findOrderByReceiptToken(body.upgradeFrom);
  if (body.upgradeFrom !== null && source === null) throw notFound();

  const licence = isLicenceType(body.licence) ? body.licence : null;
  let priced: Priced | null = null;
  if (licence !== null) {
    if (source !== null) priced = await priceUpgrade(model, licence, source);
    else if (licence === 'edition') priced = await priceEdition(model);
  }

  const { email, locale } = validateFields(body);
  if (licence === null) throw validationFailed([fieldError('licence', 'choose_one')]);
  if (priced === null) priced = await priceLicence(model, licence);

  const orderRef = newOrderRef();
  const receiptToken = newToken('rcp_');
  const description = chargeDescription(
    model.title,
    licence,
    priced.editionNumber,
    source !== null,
  );

  let accountId: string;
  let invoiceId: string;
  let paymentId: string;
  try {
    accountId = await ensureAccount(buyerAccountKey(email));
    invoiceId = await createExternalCharge(accountId, priced.amountCents, description);
    paymentId = await payInvoice(accountId, invoiceId, priced.amountCents);
  } catch (error) {
    // A claimed copy whose charge fails is released, and nothing is recorded.
    if (priced.editionNumber !== null) await releaseCopy(model.id, priced.editionNumber);
    throw error;
  }

  const order = await insertOrder({
    orderRef,
    receiptToken,
    modelId: model.id,
    email,
    licence,
    seats: seatsFor(licence),
    amountCents: priced.amountCents,
    editionNumber: priced.editionNumber,
    locale,
    upgradeFromOrderId: source?.id ?? null,
    killbillAccountId: accountId,
    killbillInvoiceId: invoiceId,
    killbillPaymentId: paymentId,
  });

  if (priced.editionNumber !== null) {
    await attachCopyToOrder(model.id, priced.editionNumber, order.id);
  }
  if (source !== null) await markUpgraded(source.id, licence);

  await sendReceiptEmail({
    orderRef: order.orderRef,
    receiptToken: order.receiptToken,
    email: order.email,
    locale: order.locale,
    licence: order.licence,
    amountCents: order.amountCents,
    editionNumber: order.editionNumber,
    editionTotal: order.editionTotal,
  });

  return json(201, {
    order: order.orderRef,
    receipt_url: `/receipts/${order.receiptToken}`,
    licence: order.licence,
    amount_cents: order.amountCents,
    currency: 'EUR',
    edition_number: order.editionNumber,
  });
}

export async function checkoutHandler(ctx: RequestContext): Promise<Reply> {
  const key = ctx.idempotencyKey;
  if (key === null) throw new ApiError('idempotency_key_required');
  return withIdempotency('checkout', key, ctx.body, async () => runCheckout(ctx));
}
