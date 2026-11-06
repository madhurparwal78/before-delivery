import type { Quota, TravelClass } from './berths';
import { istHourMinute, istLabelDate } from './ist';
import type { RunInventory, Stretch } from './inventory';
import { waitlistCap } from './inventory';
import type { WaitingList } from './schedule';
import type { BookingWindowState } from './windows';

export type QueueName = WaitingList | 'RAC';

export type WaitingCounts = Readonly<Record<WaitingList, number>>;

export const EMPTY_WAITING_COUNTS: WaitingCounts = { GNWL: 0, RLWL: 0, PQWL: 0, TQWL: 0 };

export interface AvailabilityCounts {
  readonly avl: number;
  readonly rac: number | null;
  readonly wl_type: WaitingList | null;
  readonly wl: number | null;
  readonly wl_cap: number | null;
  /** GNWL, RLWL and PQWL taken together, which is what the General cap counts. */
  readonly general_wl_total: number;
}

export function generalWaitlistTotal(counts: WaitingCounts): number {
  return counts.GNWL + counts.RLWL + counts.PQWL;
}

/** Availability counts for a train, run date, class, quota and stretch, read from the actual holds. */
export function availabilityCounts(
  inventory: RunInventory,
  travelClass: TravelClass,
  quota: Quota,
  stretch: Stretch,
  generalList: Exclude<WaitingList, 'TQWL'>,
  counts: WaitingCounts,
): AvailabilityCounts {
  const coachCount = inventory.coaches.length;
  const generalTotal = generalWaitlistTotal(counts);
  if (quota === 'GN') {
    return {
      avl: inventory.countFreeBerthsOfPool('GN', stretch),
      rac: inventory.countFreeRacPlaces(stretch),
      wl_type: generalList,
      wl: counts[generalList],
      wl_cap: waitlistCap(coachCount, travelClass, 'GN'),
      general_wl_total: generalTotal,
    };
  }
  if (quota === 'TQ') {
    return {
      avl: inventory.countFreeBerthsOfPool('TQ', stretch),
      rac: null,
      wl_type: 'TQWL',
      wl: counts.TQWL,
      wl_cap: waitlistCap(coachCount, travelClass, 'TQ'),
      general_wl_total: generalTotal,
    };
  }
  return {
    avl: inventory.countFreeBerthsOfPool(quota, stretch),
    rac: null,
    wl_type: null,
    wl: null,
    wl_cap: null,
    general_wl_total: generalTotal,
  };
}

export function availabilityLabel(
  quota: Quota,
  state: BookingWindowState,
  opening: number,
  counts: AvailabilityCounts,
): string {
  if (state === 'chart_prepared') return 'CHART PREPARED';
  if (state === 'not_yet_open') {
    return quota === 'TQ'
      ? `TATKAL OPENS ${istLabelDate(opening)} ${istHourMinute(opening)} IST`
      : `OPENS ${istLabelDate(opening)}`;
  }
  if (quota === 'GN') {
    const regret = counts.general_wl_total >= (counts.wl_cap ?? 0);
    const tail = regret ? 'REGRET' : `${counts.wl_type} ${counts.wl}`;
    return `AVL ${counts.avl} / RAC ${counts.rac} / ${tail}`;
  }
  if (quota === 'TQ') {
    const regret = (counts.wl ?? 0) >= (counts.wl_cap ?? 0);
    return regret ? `AVL ${counts.avl} / REGRET` : `AVL ${counts.avl} / TQWL ${counts.wl}`;
  }
  return counts.avl === 0 ? 'NOT AVAILABLE' : `AVL ${counts.avl}`;
}
