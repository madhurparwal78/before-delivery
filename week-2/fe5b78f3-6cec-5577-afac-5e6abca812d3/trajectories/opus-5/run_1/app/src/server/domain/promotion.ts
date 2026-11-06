import type { BerthPool, BerthType } from './berths';
import { berthSpec } from './berths';
import type { HeldPlace, RunInventory, Stretch } from './inventory';
import type { WaitingList } from './schedule';

export interface QueuedPassenger extends Stretch {
  readonly pnr: string;
  readonly passengerNumber: number;
  readonly queue: WaitingList | 'RAC';
  readonly position: number;
  /** Set for RAC entries: the side lower and place they hold. */
  readonly place: HeldPlace | null;
}

export interface FreedBerth extends Stretch {
  readonly coach: string;
  readonly berth: number;
  readonly pool: BerthPool;
}

export type Promotion =
  | {
    readonly kind: 'to_confirmed';
    readonly pnr: string;
    readonly passengerNumber: number;
    readonly from: WaitingList | 'RAC';
    readonly coach: string;
    readonly berth: number;
    readonly berthType: BerthType;
    readonly releasedPlace: HeldPlace | null;
  }
  | {
    readonly kind: 'to_rac';
    readonly pnr: string;
    readonly passengerNumber: number;
    readonly from: WaitingList;
    readonly place: HeldPlace;
  };

/** Waiting lists are served in this order when a berth or an RAC place frees up. */
const WAITING_ORDER: readonly WaitingList[] = ['GNWL', 'RLWL', 'PQWL'];

function byCoachThenBerth(
  coaches: readonly { readonly code: string }[],
  a: { coach: string; berth: number },
  b: { coach: string; berth: number },
): number {
  const order = coaches.findIndex((coach) => coach.code === a.coach)
    - coaches.findIndex((coach) => coach.code === b.coach);
  return order !== 0 ? order : a.berth - b.berth;
}

/**
 * The promotion order, run inside the same change as the cancellation that frees a berth or place.
 * A freed General berth goes to the first fitting RAC passenger, then to the first fitting waiting
 * passenger. A freed RAC place goes to the first fitting waiting passenger.
 */
export function planPromotions(
  inventory: RunInventory,
  waiting: readonly QueuedPassenger[],
  freedBerths: readonly FreedBerth[],
  freedPlaces: readonly HeldPlace[],
): Promotion[] {
  const promotions: Promotion[] = [];
  const moved = new Set<string>();
  const identify = (passenger: QueuedPassenger): string =>
    `${passenger.pnr}/${passenger.passengerNumber}`;

  const racQueue = [...waiting]
    .filter((entry) => entry.queue === 'RAC')
    .sort((a, b) => a.position - b.position);
  const waitLists = new Map<WaitingList, QueuedPassenger[]>();
  for (const list of [...WAITING_ORDER, 'TQWL' as WaitingList]) {
    waitLists.set(
      list,
      [...waiting].filter((entry) => entry.queue === list).sort((a, b) => a.position - b.position),
    );
  }

  const generalBerths = freedBerths
    .filter((berth) => berth.pool === 'GN')
    .sort((a, b) => byCoachThenBerth(inventory.coaches, a, b));
  const tatkalBerths = freedBerths
    .filter((berth) => berth.pool === 'TQ')
    .sort((a, b) => byCoachThenBerth(inventory.coaches, a, b));
  const places: HeldPlace[] = [...freedPlaces].sort(
    (a, b) => byCoachThenBerth(inventory.coaches, a, b) || a.slot - b.slot,
  );

  const fits = (berth: { coach: string; berth: number }, passenger: Stretch): boolean =>
    inventory.isBerthFree(berth.coach, berth.berth, passenger);

  const confirm = (
    passenger: QueuedPassenger,
    berth: { coach: string; berth: number },
  ): void => {
    inventory.add({ coach: berth.coach, berth: berth.berth, slot: 0, ...passenger });
    if (passenger.place !== null) inventory.remove(passenger.place);
    moved.add(identify(passenger));
    promotions.push({
      kind: 'to_confirmed',
      pnr: passenger.pnr,
      passengerNumber: passenger.passengerNumber,
      from: passenger.queue,
      coach: berth.coach,
      berth: berth.berth,
      berthType: berthSpec(berth.berth).type,
      releasedPlace: passenger.place,
    });
    if (passenger.place !== null) places.push(passenger.place);
  };

  const unmovedBerths: FreedBerth[] = [];
  for (const berth of generalBerths) {
    const candidate = racQueue.find(
      (entry) => !moved.has(identify(entry)) && fits(berth, entry),
    );
    if (candidate === undefined) {
      unmovedBerths.push(berth);
      continue;
    }
    confirm(candidate, berth);
  }

  for (const berth of unmovedBerths) {
    const candidate = WAITING_ORDER.flatMap((list) => waitLists.get(list) ?? [])
      .find((entry) => !moved.has(identify(entry)) && fits(berth, entry));
    if (candidate !== undefined) confirm(candidate, berth);
  }

  for (const berth of tatkalBerths) {
    const candidate = (waitLists.get('TQWL') ?? [])
      .find((entry) => !moved.has(identify(entry)) && fits(berth, entry));
    if (candidate !== undefined) confirm(candidate, berth);
  }

  places.sort((a, b) => byCoachThenBerth(inventory.coaches, a, b) || a.slot - b.slot);
  for (const place of places) {
    const candidate = WAITING_ORDER.flatMap((list) => waitLists.get(list) ?? [])
      .find(
        (entry) => !moved.has(identify(entry))
          && inventory.isRacPlaceFree(place.coach, place.berth, place.slot, entry),
      );
    if (candidate === undefined) continue;
    const taken: HeldPlace = {
      coach: place.coach,
      berth: place.berth,
      slot: place.slot,
      fromSeq: candidate.fromSeq,
      toSeq: candidate.toSeq,
    };
    inventory.add(taken);
    moved.add(identify(candidate));
    promotions.push({
      kind: 'to_rac',
      pnr: candidate.pnr,
      passengerNumber: candidate.passengerNumber,
      from: candidate.queue as WaitingList,
      place: taken,
    });
  }

  return promotions;
}
