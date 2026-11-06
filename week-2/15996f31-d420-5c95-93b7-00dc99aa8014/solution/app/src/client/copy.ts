// Feedback copy shared by every screen (brief: Feedback states → Other copy).

import type { Result } from "./api.js";

export const COPY = {
  network: "Bloom Desk can't reach its server. Check your connection and try again.",
  sessionEnded: "Your session has ended. Sign in again.",
  notFound: "That record isn't available to you.",
  keyReused: "That request was already sent with different details. Reload and try again.",
  serverError: "Something went wrong on our side. Try again in a minute.",
};

/** The generic refusal for a failed request; `stateLabel` names the order for "any other 409". */
export function genericProblem(result: Extract<Result<unknown>, { ok: false }>, stateLabel?: () => string): string {
  if (result.network) return COPY.network;
  if (result.status === 401) return COPY.sessionEnded;
  if (result.status === 404) return COPY.notFound;
  if (result.status === 409 && result.error?.error === "idempotency_key_reused") return COPY.keyReused;
  if (result.status === 409 && stateLabel) return stateLabel();
  if (result.status >= 500) return COPY.serverError;
  return result.error?.message ?? COPY.serverError;
}
