import type { OrderStatus } from '../../domain/orders.ts';
import { query, transaction } from '../db.ts';
import { queueLapseNotice, type LapseNoticeLine } from '../notices.ts';
import { serverNow, windowRow } from '../reads.ts';
import type { WindowRow } from '../records.ts';
import { creditWindowAndAllocation, removeOpenCards } from './common.ts';

/**
 * The lapse at a window's closing instant. Every read and write that touches a
 * window, an order, a card list, an allocation, search or totals runs this
 * first, so the first answer at or after the closing instant already shows it.
 */
export async function applyDueLapses(): Promise<void> {
  const now = serverNow();
  const due = await query<{ id: string }>(
    'select id from windows where closes_at <= $1 and lapse_processed = false order by id',
    [now],
  );
  for (const row of due.rows) await lapseWindow(row.id, now);
}

interface LapsingOrder {
  number: string;
  grower_id: number;
  status: OrderStatus;
  volume_ml: string;
}

async function lapseWindow(windowId: string, now: Date): Promise<void> {
  await transaction(async (client) => {
    // The guarded claim: of however many reads judge this close at once, one
    // transaction closes the orders and writes the notices.
    const claimed = await client.query<{ id: string }>(
      'update windows set lapse_processed = true where id = $1 and lapse_processed = false and closes_at <= $2 returning id',
      [windowId, now],
    );
    if (claimed.rows[0] === undefined) return;

    const window = (await windowRow(windowId, client)) as WindowRow;
    const lapsing = await client.query<LapsingOrder>(
      `select number, grower_id, status, volume_ml from orders
        where window_id = $1 and status in ('requested','scheduled') order by number for update`,
      [windowId],
    );

    const byGrower = new Map<number, LapseNoticeLine[]>();
    const growerIds = [...new Set(lapsing.rows.map((row) => row.grower_id))].sort((a, b) => a - b);
    for (const growerId of growerIds) {
      await client.query('select id from users where id = $1 for update', [growerId]);
    }

    for (const order of lapsing.rows) {
      const wasScheduled = order.status === 'scheduled';
      if (wasScheduled) {
        await creditWindowAndAllocation(client, windowId, order.grower_id, BigInt(order.volume_ml));
        await removeOpenCards(client, order.number);
      }
      await client.query(
        "update orders set status = 'closed', conflict = 'lapsed', closed_after_flow = false where number = $1",
        [order.number],
      );
      const lines = byGrower.get(order.grower_id) ?? [];
      lines.push({ number: order.number, volumeMl: BigInt(order.volume_ml), wasScheduled });
      byGrower.set(order.grower_id, lines);
    }

    for (const growerId of growerIds) {
      await queueLapseNotice(client, window, growerId, byGrower.get(growerId) as LapseNoticeLine[]);
    }
  });
}
