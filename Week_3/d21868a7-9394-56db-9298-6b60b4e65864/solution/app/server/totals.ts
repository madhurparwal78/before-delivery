// Channel totals, read from the same stored window figures as every other screen.
import type { Db } from "./db.ts";
import { formatMl, type Milli } from "./decimal.ts";
import { FieldErrors } from "./http.ts";
import { windowsOpeningBetween } from "./records.ts";
import { districtPeriod } from "./time.ts";

export async function channelTotals(db: Db, query: URLSearchParams) {
  // The period is optional, but only as a pair: one date without the other reports the missing one.
  const from = query.get("from");
  const to = query.get("to");
  const errors = new FieldErrors();
  const period = from === null && to === null ? null : districtPeriod(from, to, errors);
  errors.throwIfAny();
  const windows = await windowsOpeningBetween(db, period?.from ?? null, period?.to ?? null);
  const channels = (await db.query<{ id: string }>("SELECT id FROM channel ORDER BY rail_order")).rows;
  return {
    channels: channels.map((channel) => {
      const own = windows.filter((w) => w.channel_id === channel.id);
      const sum = (pick: (w: (typeof own)[number]) => Milli) => formatMl(own.reduce((total, w) => total + pick(w), 0n));
      return {
        channel_id: channel.id,
        cap_volume_ml: sum((w) => w.cap_volume_milli),
        committed_ml: sum((w) => w.committed_milli),
        delivered_ml: sum((w) => w.delivered_milli),
        remaining_ml: sum((w) => w.remaining_milli),
        windows: own.map((w) => ({
          window_id: w.id,
          label: w.label,
          cap_volume_ml: formatMl(w.cap_volume_milli),
          committed_ml: formatMl(w.committed_milli),
          delivered_ml: formatMl(w.delivered_milli),
          remaining_ml: formatMl(w.remaining_milli),
        })),
      };
    }),
  };
}
