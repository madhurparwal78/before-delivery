// Cancellation inside a run and the promotion order that follows it (brief: Promotion order).
import { poolOf } from "./berths.js";
import { isChild } from "./fare.js";
import { type RunPassenger, type RunState, berthFree, inQueueOrder, nextSeq, racPlaceFree, renumber } from "./run.js";
import { GENERAL_LISTS, cancelled, isFinal } from "./status.js";

type Freed = { kind: "berth"; coach: string; berth: number } | { kind: "rac"; coach: string; berth: number; place: number };

function release(p: RunPassenger): Freed | null {
  if (p.status === "CNF" && p.coach && p.berth) return { kind: "berth", coach: p.coach, berth: p.berth };
  if (p.status === "RAC" && p.coach && p.berth && p.racPlace) return { kind: "rac", coach: p.coach, berth: p.berth, place: p.racPlace };
  return null;
}

function firstFitting(state: RunState, lists: string[], fits: (p: RunPassenger) => boolean): RunPassenger | undefined {
  for (const list of lists) {
    const found = inQueueOrder(state.passengers, list as RunPassenger["status"]).find(fits);
    if (found) return found;
  }
  return undefined;
}

/** Freed General berths go to RAC first, then GNWL, RLWL, PQWL; freed RAC places to GNWL, RLWL, PQWL; Tatkal to TQWL. */
function promote(state: RunState, freed: Freed[]): void {
  const queue = [...freed];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const resource = next;
    if (resource.kind === "berth") {
      const pool = poolOf(resource.berth);
      if (pool !== "GN" && pool !== "TQ") continue;
      const lists = pool === "GN" ? ["RAC", ...GENERAL_LISTS] : ["TQWL"];
      const fits = (p: RunPassenger): boolean => berthFree(state.passengers, resource.coach, resource.berth, p);
      for (let winner = firstFitting(state, lists, fits); winner; winner = firstFitting(state, lists, fits)) {
        const vacated = release(winner);
        if (vacated) queue.push(vacated);
        Object.assign(winner, { status: "CNF", coach: resource.coach, berth: resource.berth, racPlace: null, seq: null });
      }
    } else {
      const fits = (p: RunPassenger): boolean =>
        racPlaceFree(state.passengers, resource.coach, resource.berth, resource.place, p);
      for (let winner = firstFitting(state, GENERAL_LISTS, fits); winner; winner = firstFitting(state, GENERAL_LISTS, fits)) {
        Object.assign(winner, {
          status: "RAC", coach: resource.coach, berth: resource.berth, racPlace: resource.place, seq: nextSeq(state.passengers),
        });
      }
    }
  }
}

/**
 * Cancels the selected passengers of one PNR; when every passenger aged 5 or over is then cancelled, its children go too.
 * Before the chart instant the freed berths and places cascade through the queues inside this same change.
 */
export function cancelPassengers(state: RunState, pnr: string, numbers: number[], beforeChart: boolean): void {
  const own = state.passengers.filter((p) => p.pnr === pnr);
  const freed: Freed[] = [];
  const cancel = (p: RunPassenger): void => {
    const vacated = release(p);
    if (vacated) freed.push(vacated);
    Object.assign(p, { ...cancelled(), racPlace: null, seq: null });
  };
  own.filter((p) => numbers.includes(p.number)).forEach(cancel);
  if (own.every((p) => isChild(p.age) || p.status === "CAN")) own.filter((p) => !isFinal(p.status)).forEach(cancel);
  if (!beforeChart) return;
  promote(state, freed);
  renumber(state.passengers);
}
