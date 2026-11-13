import { formatMl, type Ml } from '../../domain/decimal.ts';
import { type Period, periodCoversOpening } from '../../domain/period.ts';
import { pool } from '../db.ts';
import { windowRows } from '../reads.ts';
import { labelOf, windowFigures } from '../records.ts';

/** Channel totals, read from the same stored window figures as every other surface. */

export async function totalsBody(period: Period | null): Promise<Record<string, unknown>> {
  const channels = await pool.query<{ id: string }>('select id from channels order by rail_order');
  const windows = await windowRows({});

  const result = channels.rows.map((channel) => {
    const covered = windows.filter(
      (window) => window.channel_id === channel.id && (period === null || periodCoversOpening(period, window.opens_at)),
    );
    let capVolume: Ml = 0n;
    let committed: Ml = 0n;
    let delivered: Ml = 0n;
    const windowBodies = covered.map((window) => {
      const figures = windowFigures(window);
      capVolume += figures.capVolumeMl;
      committed += figures.committedMl;
      delivered += figures.deliveredMl;
      return {
        window_id: window.id,
        label: labelOf(window),
        cap_volume_ml: formatMl(figures.capVolumeMl),
        committed_ml: formatMl(figures.committedMl),
        delivered_ml: formatMl(figures.deliveredMl),
        remaining_ml: formatMl(figures.remainingMl),
      };
    });
    return {
      channel_id: channel.id,
      cap_volume_ml: formatMl(capVolume),
      committed_ml: formatMl(committed),
      delivered_ml: formatMl(delivered),
      remaining_ml: formatMl(capVolume - committed),
      windows: windowBodies,
    };
  });

  return { channels: result };
}
