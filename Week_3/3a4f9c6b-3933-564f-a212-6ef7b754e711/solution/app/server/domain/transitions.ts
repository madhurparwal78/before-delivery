// The promotion state machine: the only place a promotion's state changes, each change appending
// one history entry (brief: Promotion states and transitions).
import type { PromotionState } from "../../shared/api.js";
import type { Tx } from "../db.js";
import { ApiError } from "../errors.js";

type Trigger =
  | "request" | "approve" | "reject" | "lapse" | "start" | "window_check" | "recheck" | "break_freeze" | "report" | "rollback";

const LEGAL: readonly [PromotionState, PromotionState, Trigger][] = [
  ["requested", "awaiting_approval", "request"],
  ["requested", "queued", "request"],
  ["awaiting_approval", "approved", "approve"],
  ["awaiting_approval", "rejected", "reject"],
  ["awaiting_approval", "expired", "lapse"],
  ["approved", "queued", "start"],
  ["approved", "expired", "lapse"],
  ["window_blocked", "expired", "lapse"],
  ["queued", "applying", "window_check"],
  ["queued", "window_blocked", "window_check"],
  ["window_blocked", "queued", "recheck"],
  ["window_blocked", "queued", "break_freeze"],
  ["queued", "applying", "break_freeze"],
  ["applying", "health_wait", "report"],
  ["applying", "healthy", "report"],
  ["applying", "degraded", "report"],
  ["health_wait", "healthy", "report"],
  ["health_wait", "degraded", "report"],
  ["healthy", "rolled_back", "rollback"],
  ["degraded", "rolled_back", "rollback"],
];

interface Stateful { id: string; state: PromotionState }

/** Refuses a trigger the current state does not accept (409 invalid_transition with the state). */
export function expectTrigger(promotion: Stateful, trigger: Trigger): void {
  if (!LEGAL.some(([from, , via]) => from === promotion.state && via === trigger)) {
    throw new ApiError("invalid_transition", `A promotion in state ${promotion.state} cannot do that.`, { state: promotion.state });
  }
}

export async function recordRequested(tx: Tx, promotionId: string, actor: string, at: Date): Promise<void> {
  await tx.query("INSERT INTO promotion_history (promotion_id, from_state, to_state, at, actor) VALUES ($1, NULL, 'requested', $2, $3)",
    [promotionId, at, actor]);
}

export async function moveTo(tx: Tx, promotion: Stateful, to: PromotionState, trigger: Trigger, actor: string, at: Date): Promise<void> {
  if (!LEGAL.some(([from, next, via]) => from === promotion.state && next === to && via === trigger)) {
    throw new ApiError("invalid_transition", `A promotion in state ${promotion.state} cannot become ${to}.`, { state: promotion.state });
  }
  await tx.query("UPDATE promotions SET state = $2 WHERE id = $1", [promotion.id, to]);
  await tx.query("INSERT INTO promotion_history (promotion_id, from_state, to_state, at, actor) VALUES ($1, $2, $3, $4, $5)",
    [promotion.id, promotion.state, to, at, actor]);
  promotion.state = to;
}
