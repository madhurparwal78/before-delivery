// Table fit: seat-range fit, eligibility for a guest hold, and the status each table shows on the plan.
import type { PlanStatus } from "../../shared/api.js";
import { catalog, type Target } from "../catalog.js";
import { apiErrors, type ApiError } from "../errors.js";
import type { Occupancy } from "./occupancy.js";
import { turnWindow } from "./turn.js";

/** A table or pair fits a party when its minimum seats <= party <= its maximum seats. */
export function fitsParty(target: Target, partySize: number): boolean {
  return target.minSeats <= partySize && partySize <= target.maxSeats;
}

/** Fitting targets free for the party's whole window; only those with the smallest maximum seats are eligible. */
export function eligibleTargets(occupancy: Occupancy, partySize: number, slotStart: Date): Target[] {
  const window = turnWindow(partySize, slotStart);
  const free = catalog().targets.filter((target) => fitsParty(target, partySize) && occupancy.isFree(target, window));
  const smallest = Math.min(...free.map((target) => target.maxSeats));
  return free.filter((target) => target.maxSeats === smallest);
}

/** Occupied targets are taken; free eligible ones fit; every other free one is not for the party. */
export function planStatuses(occupancy: Occupancy, partySize: number, slotStart: Date): Map<string, PlanStatus> {
  const window = turnWindow(partySize, slotStart);
  const eligible = new Set(eligibleTargets(occupancy, partySize, slotStart).map((target) => target.targetId));
  return new Map(
    catalog().targets.map((target): [string, PlanStatus] => {
      if (!occupancy.isFree(target, window)) return [target.targetId, "taken"];
      return [target.targetId, eligible.has(target.targetId) ? "fits" : "not_for_party"];
    }),
  );
}

/** Why a guest hold on this target is refused, in the published order, or null when it may be granted. */
export function holdRefusal(occupancy: Occupancy, target: Target, partySize: number, slotStart: Date): ApiError | null {
  if (!fitsParty(target, partySize)) return apiErrors.tableNotForParty();
  if (!occupancy.isFree(target, turnWindow(partySize, slotStart))) return apiErrors.tableTaken();
  const eligible = eligibleTargets(occupancy, partySize, slotStart);
  return eligible.some((candidate) => candidate.targetId === target.targetId) ? null : apiErrors.tableNotForParty();
}
