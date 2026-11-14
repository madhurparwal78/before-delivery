/** The intake states of a stored enquiry, and the only changes between them. */

export type IntakeState = "pending" | "sent" | "failed";

export interface Transition {
  from: IntakeState;
  to: IntakeState;
}

export const INITIAL_STATE: IntakeState = "pending";

export const TRANSITIONS = {
  deliver: { from: "pending", to: "sent" },
  fail: { from: "pending", to: "failed" },
  retry: { from: "failed", to: "pending" },
} as const satisfies Record<string, Transition>;
