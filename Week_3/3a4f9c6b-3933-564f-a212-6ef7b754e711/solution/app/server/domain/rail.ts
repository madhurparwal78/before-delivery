// Rail phase and progress of an edge, from the state of the latest promotion into its target stage,
// the rail segments it has reached, and the stage status shown on each node
// (brief: Rail phase and progress). The browser renders these values and never derives them.
import type { Counter, Phase, PromotionState, StageStatus } from "../../shared/api.js";
import { RAIL_SEGMENTS } from "../../shared/rail.js";

interface Rail { phase: Phase; progress: number }

const [QUEUED, WINDOW_CHECK, APPLYING, HEALTH_WAIT] = RAIL_SEGMENTS;
const round = (value: number) => Math.round(value * 1000) / 1000;
const share = (counter: Counter | null) => (counter && counter.total > 0 ? counter.in_sync / counter.total : 0);
const across = (segment: { from: number; to: number }, counter: Counter | null) =>
  round(segment.from + (segment.to - segment.from) * share(counter));

export function railOf(state: PromotionState, counter: Counter | null, failedProgress: number | null): Rail {
  switch (state) {
    case "requested":
    case "awaiting_approval":
    case "approved":
    case "queued":
      return { phase: "queued", progress: QUEUED.to };
    case "window_blocked":
      return { phase: "window_check", progress: WINDOW_CHECK.to };
    case "applying":
      return { phase: "applying", progress: across(APPLYING, counter) };
    case "health_wait":
      return { phase: "health_wait", progress: across(HEALTH_WAIT, counter) };
    case "healthy":
      return { phase: "healthy", progress: 1 };
    case "degraded":
      return { phase: "degraded", progress: failedProgress ?? 0 };
    case "rejected":
    case "expired":
    case "rolled_back":
      return { phase: "stopped", progress: 0 };
  }
}

const PHASE_SEGMENTS: Record<Phase, number> = {
  idle: 0, stopped: 0, queued: 1, window_check: 2, applying: 3, health_wait: 4, healthy: 5, degraded: 0,
};

/** Rail segments reached (brief: Reduced motion): the phase's own segment, or for a failure every segment the stroke entered. */
export function reachedOf(rail: Rail): number {
  return rail.phase === "degraded" ? RAIL_SEGMENTS.filter((s) => s.from < rail.progress).length : PHASE_SEGMENTS[rail.phase];
}

export const IDLE: Rail = { phase: "idle", progress: 0 };

/** Stage status (brief: Stage status) from its active promotion and its current revision. */
export function stageStatus(active: PromotionState | null, current: PromotionState | null): StageStatus {
  if (active === "applying" || active === "health_wait") return "progressing";
  if (active) return "out_of_sync";
  if (current === "healthy") return "healthy";
  if (current) return "degraded";
  return "not_deployed";
}
