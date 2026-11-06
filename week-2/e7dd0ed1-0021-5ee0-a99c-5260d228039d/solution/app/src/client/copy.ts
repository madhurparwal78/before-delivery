// Copy shared by several actions (brief: Feedback states).
import { ApiError } from "./api";

export const STORAGE_OUTAGE = "Farshore can't reach storage right now. Nothing was changed; try again in a minute.";
export const SUSPENDED_BANNER = "This workspace is suspended. Uploads, downloads and share links are paused.";
export const ILLEGAL_TRANSITION = "That change isn't allowed from the current state.";

export function throttledSignIn(seconds: number): string {
  return `Too many sign-in attempts. Try again in ${seconds} seconds.`;
}

// The copy for an answer no action-specific line covers: outages, suspension, or the server's own message.
export function generalCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return STORAGE_OUTAGE;
  if (error.code === "service_unavailable" || error.code === "storage_unavailable") return STORAGE_OUTAGE;
  if (error.code === "workspace_suspended") return SUSPENDED_BANNER;
  return error.message;
}
