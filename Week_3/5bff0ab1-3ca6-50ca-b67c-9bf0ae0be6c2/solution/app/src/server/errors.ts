import { FIELD, STATUS as TEXT } from "../shared/copy.js";
import type { ApiErrorBody } from "../shared/types.js";

const MESSAGES = {
  unauthenticated: "Sign in to continue.",
  session_ended: "Your session has ended. Sign in to continue.",
  bad_credentials: FIELD.badLogin,
  forbidden: "This account cannot do that.",
  not_found: "We could not find that.",
  method_not_allowed: "That method is not available here.",
  none_left: TEXT.finishGone,
  slot_taken: TEXT.slotTaken,
  ride_cut_off: TEXT.slotClosed,
  lock_expired: TEXT.lockEnded,
  lock_exists_other_finish: TEXT.otherLock,
  price_moved: "The price has been updated for today.",
  delivery_day_full: TEXT.dayFull,
  delivery_day_closed: TEXT.dayClosed,
  delivery_day_has_places: TEXT.dayHasPlaces,
  ride_exists: TEXT.rideExists,
  illegal_state: "That has already changed.",
  too_early: "That is not due yet.",
  mobile_taken: FIELD.mobileTaken,
  too_large: "That request is too large.",
  unsupported_media_type: "Send the request as JSON.",
  invalid_body: "Check the details and try again.",
  invalid_slot: "That is not a bookable slot.",
  licence_invalid: FIELD.licenceNumber,
  licence_expired: FIELD.licenceDate,
  mcwg_required: FIELD.mcwg,
  hub_unreachable: "The hub system is unreachable right now. Nothing was changed. Try again.",
  sheet_unreachable: "The price sheet could not be made. Try again.",
  notice_unreachable: "Reminders could not be turned on. Try again.",
  database_unreachable: "The service is starting up. Try again in a moment.",
  internal_error: "Something went wrong on our side. Try again.",
} as const;

type ErrorCode = keyof typeof MESSAGES;

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  session_ended: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  none_left: 409,
  slot_taken: 409,
  ride_cut_off: 409,
  lock_expired: 409,
  lock_exists_other_finish: 409,
  price_moved: 409,
  delivery_day_full: 409,
  delivery_day_closed: 409,
  delivery_day_has_places: 409,
  ride_exists: 409,
  illegal_state: 409,
  too_early: 409,
  mobile_taken: 409,
  too_large: 413,
  unsupported_media_type: 415,
  invalid_body: 422,
  invalid_slot: 422,
  licence_invalid: 422,
  licence_expired: 422,
  mcwg_required: 422,
  hub_unreachable: 503,
  sheet_unreachable: 503,
  notice_unreachable: 503,
  database_unreachable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode) {
    super(MESSAGES[code]);
    this.status = STATUS[code];
  }
}

/** The one builder of the published error body. */
export const errorBody = (code: ErrorCode): ApiErrorBody => ({ error: { code, message: MESSAGES[code] } });
export const fail = (code: ErrorCode): ApiError => new ApiError(code);
