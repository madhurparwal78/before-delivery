import type { Transaction } from '../db/pool.ts';
import {
  earliestOpening,
  rollingOpenings,
  simultaneousOpenings,
  type DropType,
  type MarketOpening,
} from '../../domain/golive.ts';
import { parseLocalDateTime } from '../../domain/time.ts';

export interface DropTiming {
  type: DropType;
  goLiveAtMs: number | null;
  copenhagenGoLive: string | null;
  localGoLive: string | null;
}

/** Each market's opening for a drop's stored timing, or null while a draft has no timing. */
export function openingsFor(timing: DropTiming): MarketOpening[] | null {
  if (timing.type === 'simultaneous') {
    return timing.goLiveAtMs === null ? null : simultaneousOpenings(timing.goLiveAtMs);
  }
  if (timing.localGoLive === null) return null;
  const wall = parseLocalDateTime(timing.localGoLive);
  return wall === null ? null : rollingOpenings(wall);
}

export async function writeTiming(
  tx: Transaction,
  dropId: string,
  timing: DropTiming,
): Promise<void> {
  const openings = openingsFor(timing);
  const earliest = openings === null ? null : earliestOpening(openings);
  await tx.query(
    `update drops
        set type = $2, go_live_at_ms = $3, copenhagen_go_live = $4, local_go_live = $5
      where id = $1`,
    [
      dropId,
      timing.type,
      earliest,
      timing.type === 'simultaneous' ? timing.copenhagenGoLive : null,
      timing.type === 'rolling' ? timing.localGoLive : null,
    ],
  );
  for (const opening of openings ?? []) {
    await tx.query(
      `update drop_markets set go_live_at_ms = $3 where drop_id = $1 and market = $2`,
      [dropId, opening.market, opening.instantMs],
    );
  }
  if (openings === null) {
    await tx.query('update drop_markets set go_live_at_ms = null where drop_id = $1', [dropId]);
  }
}
