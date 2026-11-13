import type { ClaimState } from "./types";

export type ClaimAction =
  | "confirm"
  | "identify"
  | "quote"
  | "payment"
  | "decline"
  | "dispatch"
  | "close"
  | "share_link"
  | "erase";

const ANY_LIVE: readonly ClaimState[] = ["started", "confirmed", "identified", "quoted", "declined", "dispatched", "closed"];

/** The published state machine: where each action may start and where it leads (null: the state stays). */
const TRANSITIONS: Record<ClaimAction, { from: readonly ClaimState[]; to: ClaimState | null }> = {
  confirm: { from: ["started"], to: "confirmed" },
  identify: { from: ["confirmed"], to: "identified" },
  quote: { from: ["identified", "quoted"], to: "quoted" },
  payment: { from: ["quoted"], to: null },
  decline: { from: ["quoted"], to: "declined" },
  dispatch: { from: ["quoted"], to: "dispatched" },
  close: { from: ["declined", "dispatched"], to: "closed" },
  share_link: { from: ["confirmed", "identified", "quoted", "declined", "dispatched"], to: null },
  erase: { from: ANY_LIVE, to: "erased" },
};

type Refusal = "wrong_state" | "already_paid" | "not_paid";

/** Why an action is refused now, or null when the state machine allows it. Quote and payment need an unpaid claim; dispatch needs a paid one. */
export function refusalOf(action: ClaimAction, state: ClaimState, paid: boolean): Refusal | null {
  if (!TRANSITIONS[action].from.includes(state)) return "wrong_state";
  if ((action === "quote" || action === "payment") && paid) return "already_paid";
  if (action === "dispatch" && !paid) return "not_paid";
  return null;
}

/** The server refuses with this; the browser enables a control only where it is null. */
export const allows = (action: ClaimAction, state: ClaimState, paid: boolean): boolean => refusalOf(action, state, paid) === null;

export const nextState = (action: ClaimAction, state: ClaimState): ClaimState => TRANSITIONS[action].to ?? state;
