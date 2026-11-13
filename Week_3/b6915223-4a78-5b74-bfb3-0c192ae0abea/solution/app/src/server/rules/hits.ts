import type { ChipCode } from "../../shared/api.ts";

// Free transfers and hits (brief: Business rules / Free transfers and hits).
const HIT_POINTS = 4;
const FREE_TRANSFER_STORE = 5;

export function transferHit(count: number, freeTransfersLeft: number, chip: ChipCode | null): { freeUsed: number; hit: number } {
  if (chip === "wildcard" || chip === "free_hit") return { freeUsed: 0, hit: 0 };
  const freeUsed = Math.min(count, freeTransfersLeft);
  return { freeUsed, hit: (count - freeUsed) * HIT_POINTS };
}

// A gameweek's net score is its points minus that gameweek's hit (brief: DP-49).
export function netPoints(points: number, hitPoints: number): number {
  return points - hitPoints;
}

export function freeTransfersAtDeadline(unused: number): number {
  return Math.min(FREE_TRANSFER_STORE, unused + 1);
}
