// Availability counts and labels, recomputed from the actual holds (brief: Availability counts, Availability labels).
import type { BerthState, ClassCode, CoachBerth, QueueList, Quota, Window } from "../../shared/api.js";
import { labelDate } from "../../shared/format.js";
import { BERTH_NUMBERS, POOL_BERTHS, RAC_PLACES_PER_BERTH, bayOf, berthTypeOf, poolOf } from "./berths.js";
import { istTimestamp } from "./clock.js";
import { type RunState, berthFree, racPlaceFree } from "./run.js";
import { GENERAL_LISTS } from "./status.js";

const WAITLIST_SHARE_PERCENT: Record<ClassCode, number> = { SL: 30, "3A": 60 };

/** A list holding its cap is full; a booking may bring it up to the cap exactly. */
export function isOverCap(count: number, cap: number): boolean {
  return count > cap;
}

/** The list shows REGRET while it holds its cap. */
function isFull(count: number, cap: number): boolean {
  return isOverCap(count + 1, cap);
}

/** The class's pool berths across its coaches times 30% (SL) or 60% (3A), rounded down. */
export function waitlistCap(coachCount: number, cls: ClassCode, pool: "GN" | "TQ"): number {
  return Math.floor((POOL_BERTHS[pool].length * coachCount * WAITLIST_SHARE_PERCENT[cls]) / 100);
}

interface Counts {
  avl: number;
  rac: number | null;
  wlType: QueueList | null;
  wl: number | null;
  wlCap: number | null;
  /** The whole waiting list the cap applies to (General: GNWL, RLWL and PQWL together). */
  capped: number | null;
}

export function counts(state: RunState, quota: Quota, stretch: { from: number; to: number }, generalList: QueueList): Counts {
  const held = state.passengers;
  const avl = state.coaches.reduce(
    (sum, coach) => sum + POOL_BERTHS[quota].filter((berth) => berthFree(held, coach, berth, stretch)).length,
    0,
  );
  if (quota === "LD" || quota === "SS") return { avl, rac: null, wlType: null, wl: null, wlCap: null, capped: null };
  const onList = (lists: string[]): number => held.filter((p) => lists.includes(p.status)).length;
  if (quota === "TQ") {
    const wl = onList(["TQWL"]);
    return { avl, rac: null, wlType: "TQWL", wl, wlCap: waitlistCap(state.coaches.length, state.cls, "TQ"), capped: wl };
  }
  let rac = 0;
  for (const coach of state.coaches) {
    for (const berth of POOL_BERTHS.RAC) {
      for (let place = 1; place <= RAC_PLACES_PER_BERTH; place++) {
        if (racPlaceFree(held, coach, berth, place, stretch)) rac++;
      }
    }
  }
  return {
    avl,
    rac,
    wlType: generalList,
    wl: onList([generalList]),
    wlCap: waitlistCap(state.coaches.length, state.cls, "GN"),
    capped: onList(GENERAL_LISTS),
  };
}

export function availabilityLabel(quota: Quota, window: Window, opensAt: number, c: Counts): string {
  if (window === "chart_prepared") return "CHART PREPARED";
  if (window === "not_yet_open") {
    const opening = istTimestamp(opensAt);
    return quota === "TQ" ? `TATKAL OPENS ${labelDate(opening)} ${opening.slice(11, 16)} IST` : `OPENS ${labelDate(opening)}`;
  }
  const full = c.capped !== null && c.wlCap !== null && isFull(c.capped, c.wlCap);
  if (quota === "GN") return `AVL ${c.avl} / RAC ${c.rac} / ${full ? "REGRET" : `${c.wlType} ${c.wl}`}`;
  if (quota === "TQ") return `AVL ${c.avl} / ${full ? "REGRET" : `TQWL ${c.wl}`}`;
  return c.avl === 0 ? "NOT AVAILABLE" : `AVL ${c.avl}`;
}

/** Berth states for one stretch. Identities never appear. */
export function berthStates(state: RunState, coach: string, stretch: { from: number; to: number }): CoachBerth[] {
  return BERTH_NUMBERS.map((berth) => {
    const pool = poolOf(berth);
    let berthState: BerthState;
    if (pool === "RAC") {
      const free = Array.from({ length: RAC_PLACES_PER_BERTH }, (_, i) => i + 1).filter((place) => racPlaceFree(state.passengers, coach, berth, place, stretch)).length;
      berthState = free === 2 ? "rac_free" : free === 1 ? "rac_one_free" : "rac_full";
    } else {
      berthState = berthFree(state.passengers, coach, berth, stretch) ? "free" : "taken";
    }
    return { berth, bay: bayOf(berth), type: berthTypeOf(berth), quota: pool, state: berthState };
  });
}
