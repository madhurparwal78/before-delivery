// The engagement state machine: every published transition and its guard, decided only here.
import { ApiError } from "../errors.js";

export type EngagementState = "quoted" | "deposit_paid" | "look_dev_review" | "revision_requested" | "final_review" | "delivered" | "cancelled_with_refund";
export type ReviewMilestone = "look_dev" | "final_delivery";

/** Where an engagement stands: its state, the milestone a review/revision belongs to, and whether finals are out. */
export type Stage = { state: EngagementState; review_milestone: ReviewMilestone | null; finals_out: boolean };

const CANCELLABLE: EngagementState[] = ["deposit_paid", "look_dev_review", "revision_requested", "final_review"];

/** Quote, unit and model changes happen only while quoted. */
export function assertQuoteOpen(stage: Stage): void {
  if (stage.state !== "quoted") throw new ApiError("quote_locked");
}

export function depositTransition(stage: Stage): Stage {
  if (stage.state !== "quoted") throw new ApiError("invalid_state");
  return { state: "deposit_paid", review_milestone: null, finals_out: false };
}

/** What sending for review requires and leads to; the guards on stills and payment are checked by the caller in this order. */
export function sendForReviewTransition(stage: Stage): { milestone: ReviewMilestone; next: Stage; needsLookDevPaid: boolean } {
  if (stage.state === "deposit_paid") return { milestone: "look_dev", next: { state: "look_dev_review", review_milestone: "look_dev", finals_out: false }, needsLookDevPaid: false };
  if (stage.state === "revision_requested" && stage.review_milestone === "look_dev")
    return { milestone: "look_dev", next: { state: "look_dev_review", review_milestone: "look_dev", finals_out: false }, needsLookDevPaid: false };
  if (stage.state === "revision_requested" && stage.review_milestone === "final_delivery")
    return { milestone: "final_delivery", next: { state: "final_review", review_milestone: "final_delivery", finals_out: true }, needsLookDevPaid: false };
  if (stage.state === "final_review" && !stage.finals_out)
    return { milestone: "final_delivery", next: { state: "final_review", review_milestone: "final_delivery", finals_out: true }, needsLookDevPaid: true };
  throw new ApiError("invalid_state");
}

/** The milestone a regenerated review link opens, or invalid_state. */
export function regenerateMilestone(stage: Stage): ReviewMilestone {
  if (stage.state === "look_dev_review") return "look_dev";
  if (stage.state === "revision_requested" && stage.review_milestone) return stage.review_milestone;
  if (stage.state === "final_review" && stage.finals_out) return "final_delivery";
  throw new ApiError("invalid_state");
}

/** Whether a review link's actions are open at this stage. */
export function reviewActionsOpen(stage: Stage): boolean {
  return stage.state === "look_dev_review" || (stage.state === "final_review" && stage.finals_out);
}

function reviewerGuard(stage: Stage): ReviewMilestone {
  if (stage.state === "look_dev_review") return "look_dev";
  if (stage.state === "final_review") {
    if (!stage.finals_out) throw new ApiError("finals_not_ready");
    return "final_delivery";
  }
  throw new ApiError("invalid_state");
}

export function reviewerAcceptTransition(stage: Stage): { milestone: ReviewMilestone; next: Stage } {
  const milestone = reviewerGuard(stage);
  return milestone === "look_dev"
    ? { milestone, next: { state: "final_review", review_milestone: "look_dev", finals_out: false } }
    : { milestone, next: { state: "delivered", review_milestone: "final_delivery", finals_out: true } };
}

export function reviewerRevisionTransition(stage: Stage): { milestone: ReviewMilestone; next: Stage } {
  const milestone = reviewerGuard(stage);
  return { milestone, next: { state: "revision_requested", review_milestone: milestone, finals_out: stage.finals_out } };
}

export function assertStillsAllowed(stage: Stage): void {
  if (!CANCELLABLE.includes(stage.state)) throw new ApiError("invalid_state");
}

export function cancelTransition(stage: Stage): Stage {
  if (!CANCELLABLE.includes(stage.state)) throw new ApiError("invalid_state");
  return { state: "cancelled_with_refund", review_milestone: stage.review_milestone, finals_out: stage.finals_out };
}
