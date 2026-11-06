/**
 * Every API error is an ApiError built from this table; the error handler in app.ts is the only place that turns
 * one into a response. Precedence is encoded by the order of middleware and checks in app.ts and the handlers:
 * cross_origin, unsupported_media_type, payload_too_large, unauthenticated, not_found, forbidden, idempotency,
 * state conflicts (409/412), validation (422), dependency unavailable (503).
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const ERRORS = {
  cross_origin: [403, "Cross-origin requests are not allowed."],
  unsupported_media_type: [415, "Send the request body as application/json."],
  payload_too_large: [413, "The request body is larger than 65536 bytes."],
  unauthenticated: [401, "Sign in to continue."],
  invalid_credentials: [401, "Email or password is incorrect."],
  not_found: [404, "That does not exist."],
  forbidden: [403, "Your role cannot do that."],
  audit_immutable: [405, "Correction entries are never changed or deleted."],
  idempotency_key_reused: [409, "That Idempotency-Key was already used with a different request."],
  email_taken: [409, "That email already has an account."],
  slug_taken: [409, "That club slug is taken."],
  effective_date_taken: [409, "A table already starts on that date."],
  effective_date_conflict: [409, "An event on or after that date already has timed runs."],
  classes_in_use: [409, "Missing classes used by later events."],
  event_locked: [409, "Only a draft event can be edited."],
  stale_version: [412, "Someone else changed this event. Reload to see the latest."],
  illegal_transition: [409, "That step is not available from the event's status."],
  protest_window_open: [409, "The protest window is still open."],
  protests_pending: [409, "Decide every protest before setting results final."],
  event_not_running: [409, "The event is not running."],
  registration_closed: [409, "Registration for this event is closed."],
  already_registered: [409, "You are already registered for this event."],
  car_number_taken: [409, "That car number is already taken in that class."],
  withdrawal_closed: [409, "Withdrawal closed once the event starts."],
  check_in_closed: [409, "Check-in is not open for this event."],
  already_checked_in: [409, "That driver is already checked in."],
  rota_locked: [409, "The rota is locked."],
  not_registered: [409, "That driver is not registered for this event."],
  already_assigned: [409, "You already have a work station for this event."],
  own_heat: [409, "A driver cannot work a station in the heat they drive in."],
  station_taken: [409, "That station was just taken. Pick another."],
  station_open: [409, "That station is already open."],
  heat_not_running: [409, "That car's heat is not running."],
  not_checked_in: [409, "That driver is not checked in."],
  run_already_committed: [409, "That run is already recorded."],
  results_locked: [409, "Results are final. Times can no longer change."],
  run_not_committed: [409, "Only a recorded run can be corrected."],
  protest_window_closed: [409, "The protest window has closed."],
  protest_decided: [409, "That protest was already decided."],
  already_published: [409, "Results are already published."],
  not_final: [409, "Results are not final yet."],
  not_published: [404, "Results are not published yet."],
  validation: [422, "Some fields need attention."],
  renderer_unavailable: [503, "The results PDF renderer is offline."],
  storage_unavailable: [503, "Object storage is offline."],
  mail_unavailable: [503, "The mail server did not accept the emails."],
  internal: [500, "Something went wrong on the server."],
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly fields?: Record<string, string>,
    /** Set when the error is an idempotent replay of a stored answer. */
    readonly replayed = false,
  ) {
    super(message ?? ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError("validation", undefined, fields);
}

function errorBody(error: ApiError): { error: ErrorCode; message: string; fields?: Record<string, string> } {
  return error.fields
    ? { error: error.code, message: error.message, fields: error.fields }
    : { error: error.code, message: error.message };
}

/** The single error handler: every API error response is built here, in the published shape. */
export function errorResponse(error: Error, c: Context): Response {
  if (error instanceof ApiError) {
    return c.json(errorBody(error), error.status, error.replayed ? { "Idempotent-Replayed": "true" } : {});
  }
  console.error(error);
  return c.json(errorBody(new ApiError("internal")), 500);
}
