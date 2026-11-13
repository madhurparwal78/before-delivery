import type { RoundStatus } from "./types";

export interface TransitionResult {
  readonly ok: boolean;
  readonly refusal?: RoundRefusal;
}

export type RoundRefusal =
  | "round_not_drafted"
  | "another_round_open"
  | "sheet_not_stored"
  | "round_not_open"
  | "round_not_closed"
  | "unmarked_answers"
  | "round_not_marked"
  | "disputes_pending"
  | "not_picture_round";

/**
 * The one round state machine. A round moves drafted -> open -> closed -> marked ->
 * published and never moves backwards. These helpers are pure: they read the status
 * the database last committed and name the single refusal that applies.
 */
export function statusAllowsOpen(status: RoundStatus): boolean {
  return status === "drafted";
}

export function statusAllowsClose(status: RoundStatus): boolean {
  return status === "open";
}

export function statusAllowsMarked(status: RoundStatus): boolean {
  return status === "closed";
}

export function statusAllowsPublish(status: RoundStatus): boolean {
  return status === "marked";
}

export function submitRefusal(status: RoundStatus): "round_not_open" | "round_closed" | undefined {
  if (status === "drafted") return "round_not_open";
  if (status === "closed" || status === "marked" || status === "published") return "round_closed";
  return undefined;
}

export function order(): readonly RoundStatus[] {
  return ["drafted", "open", "closed", "marked", "published"] as const;
}
