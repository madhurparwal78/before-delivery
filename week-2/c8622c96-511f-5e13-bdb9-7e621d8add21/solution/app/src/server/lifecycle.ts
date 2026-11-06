// The essay lifecycle: the only legal transitions. Every other action answers 409 illegal_transition.
import { ApiError } from "./http.js";

export type EssayState = "draft" | "in_review" | "embargoed" | "live" | "withdrawn" | "taken_down";

export type EssayAction = "edit" | "submit" | "publish" | "hold" | "lift" | "request_withdrawal" | "withdraw" | "takedown";

const ALLOWED_FROM: Record<EssayAction, EssayState[]> = {
  edit: ["draft"],
  submit: ["draft"],
  publish: ["in_review"],
  hold: ["in_review"],
  lift: ["embargoed"],
  request_withdrawal: ["embargoed", "live"],
  withdraw: ["embargoed", "live"],
  takedown: ["embargoed", "live", "withdrawn"],
};

export function assertTransition(state: EssayState, action: EssayAction): void {
  if (!ALLOWED_FROM[action].includes(state)) {
    throw new ApiError(409, "illegal_transition", `An essay that is ${state.replace("_", " ")} can't take that action.`,
      { from: state, action });
  }
}

/** publish lands in embargo when the lift is still ahead, otherwise straight in live. */
export const publishedState = (liftAt: Date, now: Date): EssayState => (liftAt > now ? "embargoed" : "live");

/** Embargoed and live essays are on the contact sheet and can be licensed. */
export const ON_SHEET: readonly EssayState[] = ["embargoed", "live"];
export const isOnSheet = (state: EssayState): boolean => ON_SHEET.includes(state);
