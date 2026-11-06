import type { Reply, RequestContext } from '../http/router.js';
import { bytes, json } from '../http/router.js';
import { ApiError, notFound } from '../http/errors.js';
import type { OrderRecord } from '../db/orders.js';
import { findOrderByReceiptToken, refundsForOrder } from '../db/orders.js';
import { currentRevision, derivativeKey, findModelById, isRebuilding } from '../db/models.js';
import { activePlan } from '../db/plan.js';
import type { LicenceType } from '../domain/money.js';
import { discountedPriceCents, upgradeAmountCents, upgradeTargets } from '../domain/money.js';
import { netPaidInChain } from '../db/orders.js';
import { getObject } from '../services/s3.js';
import { renderInvoicePdf } from '../media/pdf.js';
import { formatAmount } from '../shared/locale.js';
import { refundedLine, totalLine } from '../shared/strings.js';

export interface UpgradeOption {
  readonly licence: LicenceType;
  readonly amount_cents: number;
}

function listPriceFor(
  model: { personalCents: number; commercialCents: number | null; studioCents: number | null },
  licence: LicenceType,
): number | null {
  switch (licence) {
    case 'personal':
      return model.personalCents;
    case 'commercial':
      return model.commercialCents;
    case 'studio':
      return model.studioCents;
    case 'edition':
      return null;
  }
}

/** A read-only or unpurchasable model lists no upgrade options. */
export async function upgradeOptionsFor(order: OrderRecord): Promise<readonly UpgradeOption[]> {
  if (order.upgradedTo !== null || order.status === 'refunded') return [];
  const model = await findModelById(order.modelId, await activePlan());
  if (model === null || model.readOnly || model.state !== 'published') return [];
  const net = await netPaidInChain(order.id);
  const options: UpgradeOption[] = [];
  for (const target of upgradeTargets(order.licence)) {
    const list = listPriceFor(model, target);
    if (list === null) continue;
    const amount = upgradeAmountCents(
      discountedPriceCents(list, model.discountPercent),
      net,
    );
    if (amount > 0) options.push({ licence: target, amount_cents: amount });
  }
  return options;
}

export async function loadReceipt(token: string): Promise<OrderRecord> {
  const order = await findOrderByReceiptToken(token);
  if (order === null) throw notFound();
  return order;
}

export async function receiptPayload(order: OrderRecord): Promise<Record<string, unknown>> {
  return {
    order: order.orderRef,
    email: order.email,
    model: { slug: order.modelSlug, title: order.modelTitle },
    licence: order.licence,
    seats: order.seats,
    amount_cents: order.amountCents,
    refunded_cents: order.refundedCents,
    status: order.status,
    edition_number: order.editionNumber,
    edition_total: order.editionTotal,
    locale: order.locale,
    created_at: order.createdAt.toISOString(),
    upgraded_to: order.upgradedTo,
    upgrade_options: await upgradeOptionsFor(order),
  };
}

export async function receiptHandler(ctx: RequestContext): Promise<Reply> {
  const order = await loadReceipt(ctx.params.token ?? '');
  return json(200, await receiptPayload(order));
}

/** The invoice PDF repeats the receipt's amount, in the receipt's locale. */
export async function invoicePdfHandler(ctx: RequestContext): Promise<Reply> {
  const order = await loadReceipt(ctx.params.token ?? '');
  const locale = order.locale;
  const lines = [
    { text: locale === 'de' ? `Rechnung ${order.orderRef}` : `Invoice ${order.orderRef}`, size: 18 },
    { text: order.modelTitle, size: 12 },
    { text: totalLine(formatAmount(order.amountCents, locale), locale), size: 12 },
  ];
  for (const refund of await refundsForOrder(order.id)) {
    lines.push({
      text: refundedLine(formatAmount(refund.amountCents, locale), locale),
      size: 12,
    });
  }
  return bytes(200, 'application/pdf', renderInvoicePdf(lines), {
    headers: { 'Content-Disposition': `inline; filename="${order.orderRef}.pdf"` },
  });
}

const BUYER_FILES: Readonly<Record<string, { kind: 'glb' | 'stl'; type: string }>> = {
  'model.glb': { kind: 'glb', type: 'model/gltf-binary' },
  'model.stl': { kind: 'stl', type: 'model/stl' },
};

export async function receiptFileHandler(ctx: RequestContext): Promise<Reply> {
  const order = await loadReceipt(ctx.params.token ?? '');
  const wanted = BUYER_FILES[ctx.params.file ?? ''];
  if (wanted === undefined) throw notFound();
  if (order.status === 'refunded') throw new ApiError('licence_refunded');
  if (await isRebuilding(order.modelId)) throw new ApiError('derivatives_rebuilding');

  const revision = await currentRevision(order.modelId);
  if (revision === null) throw new ApiError('derivatives_rebuilding');
  const key = await derivativeKey(revision.id, wanted.kind);
  if (key === null) throw new ApiError('derivatives_rebuilding');
  const body = await getObject(key);
  if (body === null) throw notFound();
  return bytes(200, wanted.type, body, {
    headers: {
      'Content-Disposition': `attachment; filename="${order.modelSlug}.${wanted.kind}"`,
    },
  });
}
