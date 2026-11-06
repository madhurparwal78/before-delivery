// Coach geometry and quota pools (brief: Berths and bays).
import type { BerthPool, BerthType } from "../../shared/api.js";

const BERTHS_PER_COACH = 72;
const BERTH_TYPES_IN_BAY: BerthType[] = ["LB", "MB", "UB", "LB", "MB", "UB", "SL", "SU"];
const SENIOR_POOL = new Set([1, 4, 9, 12, 17, 20]);
const RAC_SIDE_LOWERS = new Set([7, 15, 23, 31, 39, 47]);
export const RAC_PLACES_PER_BERTH = 2;

export const BERTH_NUMBERS: readonly number[] = Array.from({ length: BERTHS_PER_COACH }, (_, i) => i + 1);

export function bayOf(berth: number): number {
  return Math.ceil(berth / 8);
}

export function berthTypeOf(berth: number): BerthType {
  return BERTH_TYPES_IN_BAY[(berth - 1) % 8] ?? "LB";
}

export function poolOf(berth: number): BerthPool {
  if (SENIOR_POOL.has(berth)) return "SS";
  if (berth >= 41 && berth <= 46) return "LD";
  if (berth >= 61) return "TQ";
  if (RAC_SIDE_LOWERS.has(berth)) return "RAC";
  return "GN";
}

/** "Lower berth" in the brief means lower or side lower. */
export function isLowerBerth(berth: number): boolean {
  const type = berthTypeOf(berth);
  return type === "LB" || type === "SL";
}

export const POOL_BERTHS: Record<BerthPool, number[]> = {
  GN: BERTH_NUMBERS.filter((b) => poolOf(b) === "GN"),
  TQ: BERTH_NUMBERS.filter((b) => poolOf(b) === "TQ"),
  LD: BERTH_NUMBERS.filter((b) => poolOf(b) === "LD"),
  SS: BERTH_NUMBERS.filter((b) => poolOf(b) === "SS"),
  RAC: BERTH_NUMBERS.filter((b) => poolOf(b) === "RAC"),
};
