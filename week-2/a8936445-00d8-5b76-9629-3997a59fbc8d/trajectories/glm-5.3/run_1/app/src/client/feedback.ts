/** The two live regions and every message they carry, per Feedback states. */

import type { ApiClientError } from "./api.js";

export interface Feedback {
  activity: HTMLElement;
  problem: HTMLElement;
  setPending(rail: HTMLElement | null, pending: boolean): void;
}

export function createFeedback(activityEl: HTMLElement, problemEl: HTMLElement): Feedback {
  return {
    activity: activityEl,
    problem: problemEl,
    setPending(rail: HTMLElement | null, pending: boolean): void {
      if (rail !== null) {
        rail.classList.toggle("pending", pending);
      }
    }
  };
}

export function showActivity(feedback: Feedback, message: string): void {
  feedback.activity.textContent = message;
  // Outage copy stays in Problem until the next successful action.
  if (message !== "") {
    feedback.problem.textContent = "";
  }
}

export function clearActivity(feedback: Feedback): void {
  feedback.activity.textContent = "";
}

export function showError(feedback: Feedback, message: string): void {
  feedback.problem.textContent = message;
}

export function clearProblem(feedback: Feedback): void {
  feedback.problem.textContent = "";
}

/**
 * The fallback table from Feedback states, used when the specific action does not name
 * its own error copy.
 */
export function fallbackCopy(e: ApiClientError): string {
  switch (e.detail.status) {
    case 401:
      return "Your session ended. Sign in again.";
    case 403:
      return "You can't do that with this account.";
    case 404:
      return "That record isn't available.";
    case 409:
      if (e.detail.code === "idempotency_conflict") {
        return "This request was already sent with different details. Reload and try again.";
      }
      return "That can't be done in this record's current state. Reload to see the latest.";
    case 410:
    case 412:
      return "That can't be done in this record's current state. Reload to see the latest.";
    case 413:
      return "That request is too large.";
    case 415:
      return "That kind of content isn't accepted.";
    case 422:
      return "Check the highlighted fields.";
    case 503:
      if (e.detail.code === "billing_unavailable") {
        return "Billing is unreachable. Nothing was changed; try again in a moment.";
      }
      if (e.detail.code === "storage_unavailable") {
        return "Document storage is unreachable. Nothing was changed; try again in a moment.";
      }
      if (e.detail.code === "mail_unavailable") {
        return "Email is unreachable. Nothing was changed; try again in a moment.";
      }
      return "Something went wrong. Try again in a moment.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}

/** 401 on any action except sign-in navigates to sign-in with its copy. */
export function isSessionEnded(e: ApiClientError): boolean {
  return e.detail.status === 401;
}
