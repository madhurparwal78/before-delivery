import type { Member } from "../auth.js";
import { ApiError, forbidden, illegalTransition } from "../http/errors.js";

// The variation state machine and who may decide a variation (brief: Variations, Who can do what).
// The one place these rules are decided.

export type VariationState = "raised" | "under_review" | "approved" | "rejected" | "withdrawn";
type VariationAction = "start_review" | "approve" | "reject" | "withdraw";
export const VARIATION_ACTIONS: readonly VariationAction[] = ["start_review", "approve", "reject", "withdraw"];

const TRANSITIONS: Record<VariationAction, { from: VariationState[]; to: VariationState }> = {
  start_review: { from: ["raised"], to: "under_review" },
  approve: { from: ["under_review"], to: "approved" },
  reject: { from: ["under_review"], to: "rejected" },
  withdraw: { from: ["raised", "under_review"], to: "withdrawn" },
};

/** States in which a variation can still be edited. */
const EDITABLE: VariationState[] = ["raised", "under_review"];

interface VariationFacts {
  state: VariationState;
  raisedBy: string;
  amountCents: number;
  currency: "HKD" | "SGD";
}

const ownVariation = (): ApiError => new ApiError(403, { error: "own_variation" });
const overApprovalLimit = (limitCents: number, currency: string): ApiError =>
  new ApiError(403, { error: "over_approval_limit", limitCents, currency });

/** The 403 refusal for a member who may not take the action on this variation, or null. */
function actorRefusal(member: Member, variation: VariationFacts, action: VariationAction): ApiError | null {
  if (action === "withdraw") return member.id === variation.raisedBy ? null : forbidden();
  if (member.role !== "director" && member.role !== "project_lead") return forbidden();
  if (action === "start_review") return null;
  if (member.id === variation.raisedBy) return ownVariation();
  if (member.role === "project_lead") {
    const limit = member.approvalLimits?.[variation.currency] ?? 0;
    if (Math.abs(variation.amountCents) > limit) return overApprovalLimit(limit, variation.currency);
  }
  return null;
}

/** Refuses (403) a member who may not take the action on this variation. */
export function checkActor(member: Member, variation: VariationFacts, action: VariationAction): void {
  const refusal = actorRefusal(member, variation, action);
  if (refusal) throw refusal;
}

/** Refuses (403) a member who can take no transition at all, before an unknown action is refused as invalid. */
export function checkAnyActor(member: Member, variation: VariationFacts): void {
  if (member.role !== "director" && member.role !== "project_lead" && member.id !== variation.raisedBy) throw forbidden();
}

/** The actions the member can take on the variation now, from the same rules that refuse them. */
export function variationActions(member: Member, variation: VariationFacts): string[] {
  const actions: string[] = VARIATION_ACTIONS.filter((action) =>
    TRANSITIONS[action].from.includes(variation.state) && actorRefusal(member, variation, action) === null);
  if (EDITABLE.includes(variation.state) && mayEdit(member, variation.raisedBy)) actions.push("edit");
  return actions;
}

/** The state an action leads to, or 409 illegal_transition. */
export function nextState(state: VariationState, action: VariationAction): VariationState {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(state)) throw illegalTransition(state, action);
  return rule.to;
}

/** Refuses an edit outside raised and under review. */
export function checkEditable(state: VariationState): void {
  if (!EDITABLE.includes(state)) throw illegalTransition(state, "edit");
}

const mayEdit = (member: Member, raisedBy: string): boolean =>
  member.role === "director" || member.role === "project_lead" || member.id === raisedBy;

/** Who may edit: director, project lead or the raiser. */
export function checkEditor(member: Member, raisedBy: string): void {
  if (!mayEdit(member, raisedBy)) throw forbidden();
}
