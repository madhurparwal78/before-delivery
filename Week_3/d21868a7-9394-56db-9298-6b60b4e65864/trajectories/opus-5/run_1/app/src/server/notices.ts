import { formatMl, type Ml } from '../domain/decimal.ts';
import { orderStatusLabel, type OrderStatus } from '../domain/orders.ts';
import { DISTRICT_ZONE, districtInstantLabel } from '../domain/time.ts';
import { PLACE_WINDOW_FULL_MESSAGE } from '../domain/errors.ts';
import type { Queryable } from './db.ts';
import { labelOf, type WindowRow } from './records.ts';

/**
 * The district's voice: every notice's subject and body, composed here and
 * queued in the same step as the decision that caused it. Notices name gate
 * workers by operator code only.
 */

export type NoticeKind = 'conflict' | 'restriction' | 'ration' | 'lapse';

interface QueuedNotice {
  kind: NoticeKind;
  windowId: string;
  growerId: number;
  toEmail: string;
  subject: string;
  body: string;
}

async function queue(client: Queryable, notice: QueuedNotice): Promise<void> {
  await client.query(
    `insert into notices (kind, window_id, grower_id, to_email, subject, body, state)
     values ($1,$2,$3,$4,$5,$6,'queued')`,
    [notice.kind, notice.windowId, notice.growerId, notice.toEmail, notice.subject, notice.body],
  );
}

async function growerEmail(client: Queryable, growerId: number): Promise<string> {
  const found = await client.query<{ email: string }>('select email from users where id = $1', [growerId]);
  return (found.rows[0] as { email: string }).email;
}

export async function queueConflictNotice(
  client: Queryable,
  window: WindowRow,
  growerId: number,
  requestedMl: Ml,
  remainingAllocationMl: Ml,
): Promise<void> {
  const label = labelOf(window);
  await queue(client, {
    kind: 'conflict',
    windowId: window.id,
    growerId,
    toEmail: await growerEmail(client, growerId),
    subject: `Ditchbook: capacity taken on ${window.channel_name}, ${label}`,
    body: [
      PLACE_WINDOW_FULL_MESSAGE,
      `Window: ${window.channel_name}, ${label}.`,
      `You requested ${formatMl(requestedMl)} ML.`,
      `Your allocation is unchanged at ${formatMl(remainingAllocationMl)} ML.`,
    ].join('\n'),
  });
}

export interface RestrictionNoticeOrder {
  number: string;
  turnout: string;
  volumeMl: Ml;
  status: OrderStatus;
  holderCode: string;
  moved: boolean;
}

export async function queueRestrictionNotice(
  client: Queryable,
  window: WindowRow,
  growerId: number,
  figures: { capMlDay: Ml; effectiveAt: Date; capVolumeMl: Ml; remainingMl: Ml },
  orders: readonly RestrictionNoticeOrder[],
): Promise<void> {
  const label = labelOf(window);
  const lines = [
    `Window: ${window.channel_name}, ${label}.`,
    `New cap ${formatMl(figures.capMlDay)} ML/day.`,
    `Effective from ${districtInstantLabel(figures.effectiveAt)} (${DISTRICT_ZONE}).`,
    `Window volume ${formatMl(figures.capVolumeMl)} ML, ${formatMl(figures.remainingMl)} ML remaining.`,
  ];
  for (const order of orders) {
    lines.push(
      `Order ${order.number} ${order.turnout} ${formatMl(order.volumeMl)} ML ${orderStatusLabel(order.status)}.` +
        ` Gate worked by ${order.holderCode}.`,
    );
    if (order.moved) {
      lines.push(
        `Order ${order.number} no longer fits and is back in requested. Its volume is back in your allocation.`,
      );
    }
  }
  await queue(client, {
    kind: 'restriction',
    windowId: window.id,
    growerId,
    toEmail: await growerEmail(client, growerId),
    subject: `Ditchbook restriction: ${window.channel_name}, ${label}`,
    body: lines.join('\n'),
  });
}

export interface RationNoticeLine {
  number: string;
  shareMl: Ml;
  requestedMl: Ml;
  rateMlDay: Ml;
  holderCode: string;
}

export async function queueRationNotice(
  client: Queryable,
  window: WindowRow,
  growerId: number,
  lines: readonly RationNoticeLine[],
): Promise<void> {
  const label = labelOf(window);
  const body = lines.map((line) =>
    line.shareMl > 0n
      ? `Order ${line.number} rationed to ${formatMl(line.shareMl)} ML of ${formatMl(line.requestedMl)} ML` +
        ` at ${formatMl(line.rateMlDay)} ML/day. Gate worked by ${line.holderCode}.`
      : `Order ${line.number} stays requested. No capacity was left for it. Gate worked by ${line.holderCode}.`,
  );
  await queue(client, {
    kind: 'ration',
    windowId: window.id,
    growerId,
    toEmail: await growerEmail(client, growerId),
    subject: `Ditchbook ration: ${window.channel_name}, ${label}`,
    body: [`Window: ${window.channel_name}, ${label}.`, ...body].join('\n'),
  });
}

export interface LapseNoticeLine {
  number: string;
  volumeMl: Ml;
  wasScheduled: boolean;
}

export async function queueLapseNotice(
  client: Queryable,
  window: WindowRow,
  growerId: number,
  lines: readonly LapseNoticeLine[],
): Promise<void> {
  const label = labelOf(window);
  const body = lines.map((line) =>
    line.wasScheduled
      ? `Order ${line.number} lapsed when the window closed. ${formatMl(line.volumeMl)} ML is back in your allocation.`
      : `Order ${line.number} lapsed when the window closed. Nothing was debited for it.`,
  );
  await queue(client, {
    kind: 'lapse',
    windowId: window.id,
    growerId,
    toEmail: await growerEmail(client, growerId),
    subject: `Ditchbook lapse: ${window.channel_name}, ${label}`,
    body: [`Window: ${window.channel_name}, ${label}.`, ...body].join('\n'),
  });
}
