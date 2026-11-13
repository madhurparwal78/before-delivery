import { capVolumeMl } from '../../domain/conversion.ts';
import { formatMl, type Ml } from '../../domain/decimal.ts';
import { ApiError, ValidationError } from '../../domain/errors.ts';
import { countsAgainstWindow, type OrderStatus } from '../../domain/orders.ts';
import { formatInstant, truncateToMinute, windowStatus } from '../../domain/time.ts';
import { pool, transaction } from '../db.ts';
import { queueRestrictionNotice, type RestrictionNoticeOrder } from '../notices.ts';
import { channelFlows, lockWindowRow, serverNow, windowRow } from '../reads.ts';
import { windowFigures, windowRecord, type WindowRow } from '../records.ts';
import { nextRestrictionId } from '../schema.ts';
import { creditWindowAndAllocation, removeOpenCards } from './common.ts';
import { requireCapMlDay, requireText } from './validate.ts';

/** Publishing a restriction: one cap from its effective minute, pro-rated. */

interface PublishOrder {
  number: string;
  grower_id: number;
  turnout: string;
  status: OrderStatus;
  volume_ml: string;
  holder_code: string;
  closed_after_flow: boolean;
  scheduled_at: Date | null;
}

export async function publishRestriction(
  windowId: string,
  input: { capMlDay: unknown; reason: unknown },
): Promise<Record<string, unknown>> {
  const window = await windowRow(windowId);
  if (window === null) throw new ApiError('not_found');

  const capMlDay = requireCapMlDay('cap_ml_day', input.capMlDay);
  const reason = requireText('reason', input.reason, 3, 200, 'Reason');

  const figures = windowFigures(window);
  if (capMlDay >= figures.effectiveCapMlDay) {
    throw ValidationError.field(
      'cap_ml_day',
      `Enter a cap below the window's current cap of ${formatMl(figures.effectiveCapMlDay)} ML/day.`,
    );
  }

  const effectiveAt = truncateToMinute(serverNow());
  const newCapVolumeMl = capVolumeMl({
    tableCapMlDay: figures.tableCapMlDay,
    hours: window.hours,
    restrictionCapMlDay: capMlDay,
    opensAt: window.opens_at,
    restrictionEffectiveAt: effectiveAt,
  });

  const protectedVolumeMl = await protectedVolume(windowId);
  if (newCapVolumeMl < protectedVolumeMl) {
    throw ValidationError.field(
      'cap_ml_day',
      `That cap leaves ${formatMl(newCapVolumeMl)} ML, below the ${formatMl(protectedVolumeMl)} ML already under way.`,
    );
  }

  const restrictionId = await transaction(async (client) => {
    const locked = (await lockWindowRow(windowId, client)) as WindowRow;
    const now = serverNow();
    if (windowStatus(locked.opens_at, locked.closes_at, now) === 'closed') throw new ApiError('window_closed');
    const existing = await client.query<{ id: string }>('select id from restrictions where window_id = $1', [windowId]);
    if (existing.rows[0] !== undefined) throw new ApiError('restriction_exists');

    const id = await nextRestrictionId(client);
    await client.query(
      'insert into restrictions (id, window_id, cap_ml_day, reason, effective_at, moved_orders) values ($1,$2,$3,$4,$5,$6)',
      [id, windowId, capMlDay.toString(), reason, effectiveAt, JSON.stringify([])],
    );

    const restricted = (await windowRow(windowId, client)) as WindowRow;
    const capVolume = windowFigures(restricted).capVolumeMl;

    const orders = await client.query<PublishOrder>(
      `select number, grower_id, turnout, status, volume_ml, holder_code, closed_after_flow, scheduled_at
         from orders where window_id = $1 order by number for update`,
      [windowId],
    );
    const growerIds = [...new Set(orders.rows.map((row) => row.grower_id))].sort((a, b) => a - b);
    for (const growerId of growerIds) {
      await client.query('select id from users where id = $1 for update', [growerId]);
    }

    let counted = orders.rows
      .filter((order) => order.status !== 'scheduled' && countsAgainstWindow(order.status, order.closed_after_flow))
      .reduce<Ml>((sum, order) => sum + BigInt(order.volume_ml), 0n);

    const scheduled = orders.rows
      .filter((order) => order.status === 'scheduled')
      .sort((a, b) => {
        const left = (a.scheduled_at as Date).getTime();
        const right = (b.scheduled_at as Date).getTime();
        if (left !== right) return left - right;
        return a.number < b.number ? -1 : 1;
      });

    const moved: string[] = [];
    let stopped = false;
    for (const order of scheduled) {
      const volumeMl = BigInt(order.volume_ml);
      if (!stopped && counted + volumeMl <= capVolume) {
        counted += volumeMl;
        continue;
      }
      stopped = true;
      await creditWindowAndAllocation(client, windowId, order.grower_id, volumeMl);
      await removeOpenCards(client, order.number);
      await client.query(
        "update orders set status = 'requested', conflict = 'restriction', scheduled_at = null where number = $1",
        [order.number],
      );
      moved.push(order.number);
    }

    await client.query('update restrictions set moved_orders = $2 where id = $1', [id, JSON.stringify(moved)]);

    const after = (await windowRow(windowId, client)) as WindowRow;
    const afterFigures = windowFigures(after);
    const current = await client.query<PublishOrder>(
      `select number, grower_id, turnout, status, volume_ml, holder_code, closed_after_flow, scheduled_at
         from orders where window_id = $1 order by number`,
      [windowId],
    );

    for (const growerId of growerIds) {
      const theirs = current.rows.filter((order) => order.grower_id === growerId);
      const notifiable = theirs.some(
        (order) => order.status === 'scheduled' || order.status === 'running' || moved.includes(order.number),
      );
      if (!notifiable) continue;
      const lines: RestrictionNoticeOrder[] = theirs.map((order) => ({
        number: order.number,
        turnout: order.turnout,
        volumeMl: BigInt(order.volume_ml),
        status: order.status,
        holderCode: order.holder_code,
        moved: moved.includes(order.number),
      }));
      await queueRestrictionNotice(
        client,
        after,
        growerId,
        {
          capMlDay,
          effectiveAt,
          capVolumeMl: afterFigures.capVolumeMl,
          remainingMl: afterFigures.remainingMl,
        },
        lines,
      );
    }

    return id;
  });

  return restrictionBody(restrictionId);
}

async function protectedVolume(windowId: string): Promise<Ml> {
  const found = await pool.query<{ total: string }>(
    `select coalesce(sum(volume_ml),0)::text as total from orders
      where window_id = $1 and (status in ('running','delivered') or (status = 'closed' and closed_after_flow))`,
    [windowId],
  );
  return BigInt((found.rows[0] as { total: string }).total);
}

interface RestrictionRow {
  id: string;
  window_id: string;
  cap_ml_day: string;
  reason: string;
  effective_at: Date;
  moved_orders: string[];
}

export async function restrictionBody(restrictionId: string): Promise<Record<string, unknown>> {
  const found = await pool.query<RestrictionRow>('select * from restrictions where id = $1', [restrictionId]);
  const row = found.rows[0];
  if (row === undefined) throw new ApiError('not_found');
  const window = (await windowRow(row.window_id)) as WindowRow;
  return {
    restriction: {
      id: row.id,
      window_id: row.window_id,
      cap_ml_day: formatMl(BigInt(row.cap_ml_day)),
      reason: row.reason,
      effective_at: formatInstant(row.effective_at),
    },
    window: windowRecord(window, serverNow(), await channelFlows()),
    moved_orders: row.moved_orders,
  };
}

/** The table cap a restricted window keeps when its capacity table changes. */
export function restrictedCapVolume(window: WindowRow, tableCapMlDay: Ml): Ml {
  const restrictionCapMlDay = window.restriction_cap_ml_day === null ? null : BigInt(window.restriction_cap_ml_day);
  return capVolumeMl({
    tableCapMlDay,
    hours: window.hours,
    restrictionCapMlDay,
    opensAt: window.opens_at,
    restrictionEffectiveAt: window.restriction_effective_at,
  });
}
