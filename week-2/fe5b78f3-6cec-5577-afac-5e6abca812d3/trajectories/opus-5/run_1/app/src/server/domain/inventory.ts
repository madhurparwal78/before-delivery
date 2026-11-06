import type { BerthPool, BerthPreference, BerthSpec, TravelClass } from './berths';
import { COACH_BERTHS, RAC_PLACES_PER_BERTH, poolBerths } from './berths';
import type { CoachRow } from './schedule';

export interface Stretch {
  readonly fromSeq: number;
  readonly toSeq: number;
}

export interface HeldPlace extends Stretch {
  readonly coach: string;
  readonly berth: number;
  /** 0 for a whole berth, 1 or 2 for one of a side lower's two RAC places. */
  readonly slot: number;
}

export function overlaps(a: Stretch, b: Stretch): boolean {
  return a.fromSeq < b.toSeq && b.fromSeq < a.toSeq;
}

/** The berths and RAC places of one run and class, with the holds standing against them. */
export class RunInventory {
  private readonly held = new Map<string, Stretch[]>();

  constructor(readonly coaches: readonly CoachRow[], holds: readonly HeldPlace[]) {
    for (const hold of holds) this.add(hold);
  }

  private static key(coach: string, berth: number, slot: number): string {
    return `${coach}/${berth}/${slot}`;
  }

  add(place: HeldPlace): void {
    const key = RunInventory.key(place.coach, place.berth, place.slot);
    const list = this.held.get(key);
    const stretch: Stretch = { fromSeq: place.fromSeq, toSeq: place.toSeq };
    if (list === undefined) this.held.set(key, [stretch]);
    else list.push(stretch);
  }

  remove(place: HeldPlace): void {
    const key = RunInventory.key(place.coach, place.berth, place.slot);
    const list = this.held.get(key);
    if (list === undefined) return;
    const index = list.findIndex(
      (stretch) => stretch.fromSeq === place.fromSeq && stretch.toSeq === place.toSeq,
    );
    if (index >= 0) list.splice(index, 1);
  }

  private isFree(coach: string, berth: number, slot: number, stretch: Stretch): boolean {
    const list = this.held.get(RunInventory.key(coach, berth, slot));
    if (list === undefined) return true;
    return !list.some((held) => overlaps(held, stretch));
  }

  isBerthFree(coach: string, berth: number, stretch: Stretch): boolean {
    return this.isFree(coach, berth, 0, stretch);
  }

  isRacPlaceFree(coach: string, berth: number, slot: number, stretch: Stretch): boolean {
    return this.isFree(coach, berth, slot, stretch);
  }

  freeBerthsOfPool(coach: string, pool: BerthPool, stretch: Stretch): BerthSpec[] {
    return poolBerths(pool).filter((spec) => this.isBerthFree(coach, spec.berth, stretch));
  }

  countFreeBerthsOfPool(pool: BerthPool, stretch: Stretch): number {
    let total = 0;
    for (const coach of this.coaches) total += this.freeBerthsOfPool(coach.code, pool, stretch).length;
    return total;
  }

  /** RAC places free over the whole stretch, lowest coach first, then lowest berth, then first place. */
  freeRacPlaces(stretch: Stretch): HeldPlace[] {
    const places: HeldPlace[] = [];
    for (const coach of this.coaches) {
      for (const spec of poolBerths('RAC')) {
        for (let slot = 1; slot <= RAC_PLACES_PER_BERTH; slot += 1) {
          if (this.isRacPlaceFree(coach.code, spec.berth, slot, stretch)) {
            places.push({ coach: coach.code, berth: spec.berth, slot, ...stretch });
          }
        }
      }
    }
    return places;
  }

  countFreeRacPlaces(stretch: Stretch): number {
    return this.freeRacPlaces(stretch).length;
  }

  /**
   * Within a coach, a passenger takes the lowest-numbered berth free over their stretch that
   * matches their berth preference; failing that, the lowest-numbered free berth.
   */
  pickBerth(
    coach: string,
    pool: BerthPool,
    stretch: Stretch,
    preference: BerthPreference,
  ): BerthSpec | null {
    const free = this.freeBerthsOfPool(coach, pool, stretch);
    if (free.length === 0) return null;
    if (preference !== 'NONE') {
      const preferred = free.find((spec) => spec.type === preference);
      if (preferred !== undefined) return preferred;
    }
    return free[0];
  }
}

/** The number of berths one coach holds in a pool. */
export function poolSizePerCoach(pool: BerthPool): number {
  return COACH_BERTHS.filter((spec) => spec.pool === pool).length;
}

const WAITLIST_CAP_PERCENT: Readonly<Record<TravelClass, number>> = { SL: 30, '3A': 60 };

/**
 * The waiting-list cap for a run and class: the class's pool berths across all its coaches times
 * 30% on SL or 60% on 3A, rounded down.
 */
export function waitlistCap(
  coachCount: number,
  travelClass: TravelClass,
  pool: 'GN' | 'TQ',
): number {
  return Math.floor((poolSizePerCoach(pool) * coachCount * WAITLIST_CAP_PERCENT[travelClass]) / 100);
}
