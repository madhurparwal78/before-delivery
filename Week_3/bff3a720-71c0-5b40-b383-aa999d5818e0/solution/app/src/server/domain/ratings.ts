import type { RatingState } from "../../shared/api";
import { plusSeconds } from "../clock";
import { config } from "../config";

export function ratingWindowCloses(arrival: Date): Date {
  return plusSeconds(arrival, config.ratingWindowDays * 86400);
}

interface RatingInput {
  /** The booking has reached `rated` (a reveal already happened). */
  revealed: boolean;
  arrived: boolean;
  arrival: Date;
  now: Date;
  submitted: number;
}

/**
 * The one rating-reveal rule. `revealed` is the outcome once both sides rated or the window closed with
 * at least one rating; `closed` is a window that shut with none.
 */
export function ratingState(input: RatingInput): RatingState {
  if (input.revealed) return "revealed";
  if (!input.arrived) return "not_open";
  const windowShut = input.now.getTime() >= ratingWindowCloses(input.arrival).getTime();
  if (input.submitted >= 2) return "revealed";
  if (windowShut) return input.submitted === 1 ? "revealed" : "closed";
  return input.submitted === 1 ? "waiting" : "open";
}
