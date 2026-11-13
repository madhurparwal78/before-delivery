import { orderRateMlDay } from '../../domain/conversion.ts';
import { formatMl, type Ml } from '../../domain/decimal.ts';
import { ApiError } from '../../domain/errors.ts';
import { rationShares, type RationCandidate } from '../../domain/ration.ts';
import { windowStatus } from '../../domain/time.ts';
import { pool, transaction } from '../db.ts';
import { queueRationNotice, type RationNoticeLine } from '../notices.ts';
import { channelFlows, lockWindowRow, serverNow, windowRow } from '../reads.ts';
import { windowFigures, windowRecord, type OrderRow, type WindowRow } from '../records.ts';
import { debitWindowAndAllocation, issueStartCard, lockAllocation, maxVolumeFor, turnoutRow } from './common.ts';

/** The proportional ration, settled in the same guarded step as a placement. */

export async function rationWindow(windowId: string): Promise<Record<string, unknown>> {
  const window = await windowRow(windowId);
  if (window === null) throw new ApiError('not_found');

  const result = await transaction(async (client) => {
    const locked = (await lockWindowRow(windowId, client)) as WindowRow;
    const now = serverNow();
    if (windowStatus(locked.opens_at, locked.closes_at, now) === 'closed') throw new ApiError('window_closed');

    const requested = await client.query<OrderRow>(
      "select * from orders where window_id = $1 and status = 'requested' order by number for update",
      [windowId],
    );
    if (requested.rows.length === 0) throw new ApiError('nothing_to_ration');

    const busyTurnouts = await client.query<{ turnout: string }>(
      `select distinct turnout from orders
        where window_id = $1 and status in ('scheduled','running')`,
      [windowId],
    );
    const busy = new Set(busyTurnouts.rows.map((row) => row.turnout));

    const seenTurnouts = new Set<string>();
    const candidateOrders: OrderRow[] = [];
    for (const order of requested.rows) {
      if (busy.has(order.turnout) || seenTurnouts.has(order.turnout)) continue;
      seenTurnouts.add(order.turnout);
      candidateOrders.push(order);
    }

    const growerIds = [...new Set(candidateOrders.map((order) => order.grower_id))].sort((a, b) => a - b);
    const allocations = new Map<number, Ml>();
    for (const growerId of growerIds) {
      allocations.set(growerId, (await lockAllocation(client, growerId)).remainingMl);
    }

    const candidates: RationCandidate[] = [];
    for (const order of candidateOrders) {
      const turnout = await turnoutRow(order.turnout, client);
      candidates.push({
        orderNumber: order.number,
        growerId: order.grower_id,
        requestedMl: BigInt(order.requested_ml),
        volumeMl: BigInt(order.volume_ml),
        turnoutMaxVolumeMl: maxVolumeFor(turnout as NonNullable<typeof turnout>, locked.hours),
        growerRemainingMl: allocations.get(order.grower_id) as Ml,
      });
    }

    const shares = rationShares(candidates, windowFigures(locked).remainingMl);
    const rationed: { order_number: string; requested_ml: string; volume_ml: string }[] = [];
    const noticeLines = new Map<number, RationNoticeLine[]>();

    for (const [index, share] of shares.entries()) {
      const order = candidateOrders[index] as OrderRow;
      const lines = noticeLines.get(order.grower_id) ?? [];
      if (share.shareMl > 0n) {
        const rateMlDay = orderRateMlDay(share.shareMl, locked.hours);
        await client.query(
          `update orders set volume_ml = $2, rate_ml_day = $3, status = 'scheduled', rationed = true,
             conflict = null, scheduled_at = $4 where number = $1`,
          [order.number, share.shareMl.toString(), rateMlDay.toString(), now],
        );
        await debitWindowAndAllocation(client, windowId, order.grower_id, share.shareMl);
        await issueStartCard(
          client,
          {
            number: order.number,
            holder_code: order.holder_code,
            standby_code: order.standby_code,
            rate_ml_day: rateMlDay.toString(),
          },
          locked,
        );
        rationed.push({
          order_number: order.number,
          requested_ml: formatMl(BigInt(order.requested_ml)),
          volume_ml: formatMl(share.shareMl),
        });
        lines.push({
          number: order.number,
          shareMl: share.shareMl,
          requestedMl: BigInt(order.requested_ml),
          rateMlDay,
          holderCode: order.holder_code,
        });
      } else {
        lines.push({
          number: order.number,
          shareMl: 0n,
          requestedMl: BigInt(order.requested_ml),
          rateMlDay: BigInt(order.rate_ml_day),
          holderCode: order.holder_code,
        });
      }
      noticeLines.set(order.grower_id, lines);
    }

    for (const growerId of growerIds) {
      await queueRationNotice(client, locked, growerId, noticeLines.get(growerId) as RationNoticeLine[]);
    }

    const stillRequested = await client.query<{ number: string }>(
      "select number from orders where window_id = $1 and status = 'requested' order by number",
      [windowId],
    );

    return { rationed, left_requested: stillRequested.rows.map((row) => row.number) };
  });

  const after = (await windowRow(windowId)) as WindowRow;
  return {
    window: windowRecord(after, serverNow(), await channelFlows(pool)),
    rationed: result.rationed,
    left_requested: result.left_requested,
  };
}
