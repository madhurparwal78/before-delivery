import type { CohortPhase } from "../../shared/api.js";
import { daysBetween } from "./time.js";

const BASELINE_DAYS = 7;
const TECHNIQUE_LAST_DAY = 27;

interface CohortState {
  published: boolean;
  closed: boolean;
  startsOn: string;
}

export interface PhaseAndWeek {
  phase: CohortPhase;
  week: number | null;
}

/** The phase a cohort is in on `today`, the server's date in its coach's time zone. */
export function cohortPhase(cohort: CohortState, today: string): PhaseAndWeek {
  if (!cohort.published) return { phase: "draft", week: null };
  const day = daysBetween(cohort.startsOn, today);
  if (cohort.closed || day > TECHNIQUE_LAST_DAY) return { phase: "closed", week: null };
  if (day < 0) return { phase: "enrolling", week: null };
  return { phase: day < BASELINE_DAYS ? "baseline" : "technique", week: Math.floor(day / 7) + 1 };
}

/** Enrolment and payment are open while a cohort is enrolling or in its baseline week. */
export function acceptsEnrollment(phase: CohortPhase): boolean {
  return phase === "enrolling" || phase === "baseline";
}

/** Refunds share the enrolment window: they close when the technique weeks start. */
export function acceptsRefund(phase: CohortPhase): boolean {
  return acceptsEnrollment(phase);
}

export function digestRuns(phase: CohortPhase): boolean {
  return phase === "baseline" || phase === "technique";
}

export type CohortTransition = "publish" | "close";

const TRANSITIONS: Record<CohortTransition, { from: CohortPhase; to: CohortPhase }> = {
  publish: { from: "draft", to: "enrolling" },
  close: { from: "technique", to: "closed" },
};

/** The illegal-transition body for a request, or null when the transition is legal from `phase`. */
export function illegalTransition(
  phase: CohortPhase,
  transition: CohortTransition,
): { error: "illegal_transition"; from: CohortPhase; to: CohortPhase } | null {
  const rule = TRANSITIONS[transition];
  return phase === rule.from ? null : { error: "illegal_transition", from: phase, to: rule.to };
}
