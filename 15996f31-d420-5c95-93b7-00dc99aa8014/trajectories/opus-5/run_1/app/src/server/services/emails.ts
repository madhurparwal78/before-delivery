import { formatMoney, formatTenths } from '../../shared/format';
import { formatCalendarDate, formatPacificDateTime } from '../../shared/pacific';
import { tierLabel } from '../../shared/labels';
import { config } from '../config';
import type { OrderAggregate } from '../data/orders';
import type { OrderFigures } from '../domain/figures';

export interface OutboxMessage {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

function latestDeliveryDate(order: OrderAggregate, blockId: string): string | null {
  let latest: string | null = null;
  for (const drop of order.drops) {
    if (drop.blockId !== blockId || drop.deliveredOn === null) continue;
    if (latest === null || drop.deliveredOn > latest) latest = drop.deliveredOn;
  }
  return latest;
}

export function placementConfirmation(
  order: OrderAggregate,
  figures: OrderFigures,
): OutboxMessage {
  const lines = order.blocks.flatMap((block) => {
    const delivered = latestDeliveryDate(order, block.blockId);
    if (delivered === null) return [];
    const hives = figures.blocks.get(block.blockId)?.hivesDelivered ?? 0;
    return [`${block.name}: ${hives} hives, delivered ${formatCalendarDate(delivered)}`];
  });
  return {
    dedupeKey: `placement:${order.id}`,
    to: order.orchard.growerEmail,
    subject: `Hives placed: ${order.orchard.name} · ${order.ref}`,
    body: [
      `The hives for ${order.orchard.name} are placed on order ${order.ref}.`,
      '',
      ...lines,
      '',
      'An inspector will count frames of bees and sign the report.',
    ].join('\n'),
  };
}

export function inspectionLinkEmail(input: {
  order: OrderAggregate;
  linkId: string;
  token: string;
  inspectorEmail: string;
  expiresAt: Date;
}): OutboxMessage {
  return {
    dedupeKey: `inspection-link:${input.linkId}`,
    to: input.inspectorEmail,
    subject: `Inspection sheet: ${input.order.orchard.name} · ${input.order.ref}`,
    body: [
      `Please count frames of bees for ${input.order.orchard.name} (${input.order.ref}).`,
      '',
      `${config.appBaseUrl}/inspect/${input.token}`,
      '',
      `This link opens only this orchard's inspection sheet. It stops working when you sign the report or at ${formatPacificDateTime(input.expiresAt)} Pacific.`,
    ].join('\n'),
  };
}

export function signedReportNotice(
  order: OrderAggregate,
  figures: OrderFigures,
  linkId: string,
): OutboxMessage {
  const lines = order.blocks.map((block) => {
    const strength = figures.blocks.get(block.blockId);
    const average = strength?.averageTenths ?? null;
    const strengthText = average === null ? 'no samples' : `${formatTenths(average)} frames`;
    return `${block.name}: ${strengthText}, ${tierLabel(strength?.tier ?? null)}, ${formatMoney(strength?.payableCents ?? 0)}`;
  });
  return {
    dedupeKey: `signed-report:${linkId}`,
    to: order.orchard.growerEmail,
    subject: `Inspection signed: ${order.orchard.name} · ${order.ref}`,
    body: [
      `The inspection of ${order.orchard.name} (${order.ref}) is signed.`,
      '',
      ...lines,
      '',
      `Payable: ${formatMoney(figures.payableCents)}`,
      'The signed report is in Bloom Desk.',
    ].join('\n'),
  };
}
