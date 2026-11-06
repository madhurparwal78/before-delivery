import type { BerthPreference, BerthType, Quota, TravelClass } from './berths';
import { isChild } from './fare';
import type { RunInventory, Stretch } from './inventory';
import type { WaitingList } from './schedule';

export type Gender = 'M' | 'F' | 'T';

export interface PartyMember {
  readonly age: number;
  readonly gender: Gender;
  readonly preference: BerthPreference;
}

/** Senior criteria: aged 60 or over, or a woman aged 45 or over. */
export function meetsSeniorCriteria(member: PartyMember): boolean {
  return member.age >= 60 || (member.gender === 'F' && member.age >= 45);
}

export type Allotment =
  | { readonly kind: 'NOSB' }
  | { readonly kind: 'CNF'; readonly coach: string; readonly berth: number; readonly berthType: BerthType }
  | { readonly kind: 'RAC'; readonly coach: string; readonly berth: number; readonly slot: number }
  | { readonly kind: 'WL'; readonly list: WaitingList };

export interface AllotmentRequest {
  readonly travelClass: TravelClass;
  readonly quota: Quota;
  readonly stretch: Stretch;
  readonly party: readonly PartyMember[];
  readonly keepInOneCoach: boolean;
  readonly generalList: Exclude<WaitingList, 'TQWL'>;
  /** Waiting-list places still inside the cap for this run and class. */
  readonly waitlistRoom: number;
}

export type AllotmentOutcome =
  | { readonly outcome: 'allotted'; readonly allotments: readonly Allotment[] }
  | { readonly outcome: 'quota_full' }
  | { readonly outcome: 'waitlist_full' };

/** A coach's room: its free pool berths, plus free Senior berths on a General booking. */
function coachRoom(
  inventory: RunInventory,
  coach: string,
  quota: Quota,
  stretch: Stretch,
  seniorCount: number,
): number {
  const pool = inventory.freeBerthsOfPool(coach, quota, stretch).length;
  if (quota !== 'GN' || seniorCount === 0) return pool;
  const senior = inventory.freeBerthsOfPool(coach, 'SS', stretch).length;
  return pool + Math.min(senior, seniorCount);
}

/** The party's coach is chosen once, before anyone is allotted. */
function choosePartyCoach(
  inventory: RunInventory,
  quota: Quota,
  stretch: Stretch,
  partySize: number,
  seniorCount: number,
): string | null {
  const rooms = inventory.coaches.map((coach) => ({
    code: coach.code,
    room: coachRoom(inventory, coach.code, quota, stretch, seniorCount),
  }));
  return rooms.find((entry) => entry.room >= partySize)?.code
    ?? rooms.find((entry) => entry.room > 0)?.code
    ?? null;
}

function takeInCoach(
  inventory: RunInventory,
  coach: string,
  quota: Quota | 'SS',
  stretch: Stretch,
  preference: BerthPreference,
): Allotment | null {
  const spec = inventory.pickBerth(coach, quota, stretch, preference);
  if (spec === null) return null;
  inventory.add({ coach, berth: spec.berth, slot: 0, ...stretch });
  return { kind: 'CNF', coach, berth: spec.berth, berthType: spec.type };
}

function takeAnyCoach(
  inventory: RunInventory,
  quota: Quota | 'SS',
  stretch: Stretch,
  preference: BerthPreference,
  startAfter: string | null,
): Allotment | null {
  const start = startAfter === null
    ? 0
    : inventory.coaches.findIndex((coach) => coach.code === startAfter) + 1;
  for (let index = Math.max(start, 0); index < inventory.coaches.length; index += 1) {
    const taken = takeInCoach(inventory, inventory.coaches[index].code, quota, stretch, preference);
    if (taken !== null) return taken;
  }
  return null;
}

function takeRacPlace(inventory: RunInventory, stretch: Stretch): Allotment | null {
  const place = inventory.freeRacPlaces(stretch)[0];
  if (place === undefined) return null;
  inventory.add(place);
  return { kind: 'RAC', coach: place.coach, berth: place.berth, slot: place.slot };
}

/**
 * Allots a whole party in PNR order: a confirmed berth, then an RAC place, then a waiting-list
 * place. The inventory is mutated as each hold is taken.
 */
export function allotParty(
  inventory: RunInventory,
  request: AllotmentRequest,
): AllotmentOutcome {
  const { quota, stretch, party, keepInOneCoach, generalList } = request;
  const adults = party.filter((member) => !isChild(member.age));
  const seniorCount = quota === 'GN' ? adults.filter(meetsSeniorCriteria).length : 0;
  const partyCoach = choosePartyCoach(inventory, quota, stretch, adults.length, seniorCount);
  const allotments: Allotment[] = [];
  let waitlisted = 0;

  for (const member of party) {
    if (isChild(member.age)) {
      allotments.push({ kind: 'NOSB' });
      continue;
    }
    if (quota === 'LD' || quota === 'SS') {
      const taken = partyCoach === null
        ? null
        : takeInCoach(inventory, partyCoach, quota, stretch, member.preference)
          ?? takeAnyCoach(inventory, quota, stretch, member.preference, partyCoach);
      if (taken === null) return { outcome: 'quota_full' };
      allotments.push(taken);
      continue;
    }
    if (quota === 'GN' && meetsSeniorCriteria(member)) {
      const senior = partyCoach === null
        ? null
        : takeInCoach(inventory, partyCoach, 'SS', stretch, member.preference)
          ?? (keepInOneCoach ? null : takeAnyCoach(inventory, 'SS', stretch, member.preference, null));
      if (senior !== null) {
        allotments.push(senior);
        continue;
      }
    }
    const pooled = partyCoach === null
      ? takeAnyCoach(inventory, quota, stretch, member.preference, null)
      : takeInCoach(inventory, partyCoach, quota, stretch, member.preference)
        ?? takeAnyCoach(inventory, quota, stretch, member.preference, partyCoach);
    if (pooled !== null) {
      allotments.push(pooled);
      continue;
    }
    if (quota === 'GN') {
      const rac = takeRacPlace(inventory, stretch);
      if (rac !== null) {
        allotments.push(rac);
        continue;
      }
    }
    waitlisted += 1;
    allotments.push({ kind: 'WL', list: quota === 'TQ' ? 'TQWL' : generalList });
  }

  if (waitlisted > request.waitlistRoom) return { outcome: 'waitlist_full' };
  return { outcome: 'allotted', allotments };
}
