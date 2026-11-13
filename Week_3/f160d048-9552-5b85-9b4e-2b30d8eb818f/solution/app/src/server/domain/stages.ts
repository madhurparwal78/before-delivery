import type { StageId } from "../../shared/reference";

const FORWARD: readonly StageId[] = ["submitted", "screening", "interview", "offer"];

/** A move is legal one step forward, one step back, or from any stage but declined to declined. */
export function isLegalStageMove(from: StageId, to: StageId): boolean {
  if (from === "declined") return false;
  if (to === "declined") return true;
  const distance = FORWARD.indexOf(to) - FORWARD.indexOf(from);
  return Math.abs(distance) === 1;
}
