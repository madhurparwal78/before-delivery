import type { PublishState } from "./types.js";

/** A page that answers at its public address. */
export function isLive(state: PublishState | undefined): boolean {
  return state === "live" || state === "live_changed";
}
