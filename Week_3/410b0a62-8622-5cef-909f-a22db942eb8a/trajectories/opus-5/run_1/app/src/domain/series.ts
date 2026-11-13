import { datesBetween } from './time.js';
import type { SeriesDay } from './types.js';

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

/**
 * The one daily series recurrence: fitness and fatigue are exponentially
 * weighted from daily stress, and form on a day uses the previous day's values.
 */
export function computeSeries(
  from: string,
  to: string,
  tssByDate: ReadonlyMap<string, number>,
  previous: { ctl: number; atl: number },
): SeriesDay[] {
  let ctl = previous.ctl;
  let atl = previous.atl;
  return datesBetween(from, to).map((date) => {
    const tss = tssByDate.get(date) ?? 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / CTL_DAYS;
    atl = atl + (tss - atl) / ATL_DAYS;
    return { date, tss, ctl, atl, tsb };
  });
}
