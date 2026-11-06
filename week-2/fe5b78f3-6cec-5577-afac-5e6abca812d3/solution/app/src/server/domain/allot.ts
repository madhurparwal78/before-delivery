// The allotment order, the options and acceptance, and the waiting-list cap (brief: Allotment, Waiting-list cap).
import type { Accept, BerthPreference, Gender, QueueList, Quota } from "../../shared/api.js";
import { POOL_BERTHS, RAC_PLACES_PER_BERTH, berthTypeOf, isLowerBerth } from "./berths.js";
import { isChild } from "./fare.js";
import { type RunPassenger, type RunState, berthFree, nextSeq, racPlaceFree, renumber } from "./run.js";
import { GENERAL_LISTS, acceptOf, describe, isWorse, worst } from "./status.js";
import { isOverCap, waitlistCap } from "./availability.js";

interface AllotPassenger {
  age: number;
  gender: Gender;
  preference: BerthPreference;
}

interface AllotRequest {
  pnr: string;
  quota: Quota;
  from: number;
  to: number;
  /** The waiting list a General booking joins, from its From stop. */
  generalList: QueueList;
  passengers: AllotPassenger[];
  keepInOneCoach: boolean;
  lowerBerthOnly: boolean;
  accept: Accept;
}

export type AllotRefusal = "quota_full" | "waitlist_full" | "party_split" | "no_lower_berth" | "availability_changed";

type AllotOutcome =
  | { ok: true; passengers: RunPassenger[] }
  | { ok: false; error: AllotRefusal; offer?: { accept: Accept; label: string } };

/** Aged 60 or over, or a woman aged 45 or over (brief: Party rules). */
export function meetsSeniorCriteria(age: number, gender: Gender): boolean {
  return age >= 60 || (gender === "F" && age >= 45);
}

export function allot(state: RunState, request: AllotRequest): AllotOutcome {
  const held = [...state.passengers];
  const stretch = { from: request.from, to: request.to };
  const adults = request.passengers.filter((p) => !isChild(p.age));
  const ownPool = request.quota;
  const general = request.quota === "GN";
  const seniors = general ? adults.filter((p) => meetsSeniorCriteria(p.age, p.gender)).length : 0;

  const freeIn = (coach: string, pool: Quota): number[] =>
    POOL_BERTHS[pool].filter((berth) => berthFree(held, coach, berth, stretch));
  const pick = (coach: string, pool: Quota, preference: BerthPreference): number | undefined => {
    const free = freeIn(coach, pool);
    return free.find((b) => berthTypeOf(b) === preference) ?? free[0];
  };
  const room = (coach: string): number =>
    freeIn(coach, ownPool).length + (general ? Math.min(freeIn(coach, "SS").length, seniors) : 0);

  if ((request.quota === "LD" || request.quota === "SS") &&
      state.coaches.reduce((sum, c) => sum + freeIn(c, ownPool).length, 0) < adults.length) {
    return { ok: false, error: "quota_full" };
  }

  const partyCoach = state.coaches.find((c) => room(c) >= adults.length) ?? state.coaches.find((c) => room(c) > 0);
  const spillOrder = partyCoach
    ? [...state.coaches.slice(state.coaches.indexOf(partyCoach)), ...state.coaches.slice(0, state.coaches.indexOf(partyCoach))]
    : [];

  const added: RunPassenger[] = [];
  const base = (number: number, p: AllotPassenger): RunPassenger => ({
    pnr: request.pnr, number, age: p.age, gender: p.gender, quota: request.quota, from: request.from, to: request.to,
    status: "NOSB", position: null, coach: null, berth: null, racPlace: null, seq: null,
  });
  const holdBerth = (passenger: RunPassenger, coach: string, berth: number): void => {
    Object.assign(passenger, { status: "CNF", coach, berth });
  };

  request.passengers.forEach((p, i) => {
    const passenger = base(i + 1, p);
    added.push(passenger);
    held.push(passenger);
    if (isChild(p.age)) return;

    if (general && meetsSeniorCriteria(p.age, p.gender)) {
      const coach = [partyCoach, ...(request.keepInOneCoach ? [] : state.coaches)]
        .find((c): c is string => c !== undefined && pick(c, "SS", p.preference) !== undefined);
      if (coach) return holdBerth(passenger, coach, pick(coach, "SS", p.preference) ?? 0);
    }
    const coach = spillOrder.find((c) => pick(c, ownPool, p.preference) !== undefined);
    if (coach) return holdBerth(passenger, coach, pick(coach, ownPool, p.preference) ?? 0);
    if (request.quota === "LD" || request.quota === "SS") return;

    if (general) {
      for (const c of state.coaches) {
        for (const berth of POOL_BERTHS.RAC) {
          for (let place = 1; place <= RAC_PLACES_PER_BERTH; place++) {
            if (racPlaceFree(held, c, berth, place, stretch)) {
              Object.assign(passenger, { status: "RAC", coach: c, berth, racPlace: place, seq: nextSeq(held) });
              return;
            }
          }
        }
      }
    }
    Object.assign(passenger, { status: general ? request.generalList : "TQWL", seq: nextSeq(held) });
  });
  renumber(held);

  const adultsAdded = added.filter((p) => !isChild(p.age));
  const lists: QueueList[] = general ? GENERAL_LISTS : ["TQWL"];
  const listPool = general ? "GN" : "TQ";
  if (request.quota === "GN" || request.quota === "TQ") {
    const onLists = held.filter((p) => (lists as string[]).includes(p.status)).length;
    if (isOverCap(onLists, waitlistCap(state.coaches.length, state.cls, listPool))) return { ok: false, error: "waitlist_full" };
  }
  if (request.keepInOneCoach &&
      (adultsAdded.some((p) => p.status !== "CNF") || new Set(adultsAdded.map((p) => p.coach)).size > 1)) {
    return { ok: false, error: "party_split" };
  }
  if (request.lowerBerthOnly && !adultsAdded.some((p) => p.status === "CNF" && isLowerBerth(p.berth ?? 0))) {
    return { ok: false, error: "no_lower_berth" };
  }
  const affected = adultsAdded.find((p) => isWorse(acceptOf(p.status), request.accept));
  if (affected) {
    return {
      ok: false,
      error: "availability_changed",
      offer: { accept: worst(adultsAdded.map((p) => acceptOf(p.status))), label: describe(affected).label },
    };
  }
  return { ok: true, passengers: added };
}
