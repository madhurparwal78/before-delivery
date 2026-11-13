// Every API error comes from this one shared builder, with the one published shape:
// {"error":{"code":"<code>","message":"<text>"}}
export type ErrorCode =
  | "unauthenticated"
  | "session_ended"
  | "bad_credentials"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "too_large"
  | "unsupported_media_type"
  | "none_left"
  | "slot_taken"
  | "ride_cut_off"
  | "lock_expired"
  | "lock_exists_other_finish"
  | "price_moved"
  | "delivery_day_full"
  | "delivery_day_closed"
  | "delivery_day_has_places"
  | "ride_exists"
  | "illegal_state"
  | "too_early"
  | "mobile_taken"
  | "invalid_body"
  | "invalid_slot"
  | "licence_invalid"
  | "licence_expired"
  | "mcwg_required"
  | "hub_unreachable"
  | "sheet_unreachable"
  | "notice_unreachable"
  | "database_unreachable";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  session_ended: "Your session has ended. Sign in to continue.",
  bad_credentials: "That mobile number and password do not match.",
  forbidden: "You cannot use this.",
  not_found: "We couldn't find that page.",
  method_not_allowed: "That method is not allowed here.",
  too_large: "That request is too large.",
  unsupported_media_type: "That request type is not allowed.",
  none_left: "That finish has just gone.",
  slot_taken: "That slot has just been taken.",
  ride_cut_off: "That slot has just closed.",
  lock_expired: "That price lock has ended.",
  lock_exists_other_finish: "You already hold a lock on this model.",
  price_moved: "The price has changed.",
  delivery_day_full: "That day has just filled.",
  delivery_day_closed: "That day has closed.",
  delivery_day_has_places: "That day has a place now.",
  ride_exists: "You already have a ride booked on this model.",
  illegal_state: "That cannot be done now.",
  too_early: "That is too early to do.",
  mobile_taken: "That mobile number already has an account.",
  invalid_body: "That request is not valid.",
  invalid_slot: "That slot is not valid.",
  licence_invalid: "That licence number is not valid.",
  licence_expired: "Your licence is not valid on the ride day.",
  mcwg_required: "A test ride needs an MCWG licence.",
  hub_unreachable: "The hub system is unreachable right now. Try again in a moment.",
  sheet_unreachable: "The price sheet could not be made right now. Try again in a moment.",
  notice_unreachable: "Reminders could not be turned on right now. Try again in a moment.",
  database_unreachable: "The database is unreachable right now. Try again in a moment.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ErrorCode, headers?: Record<string, string>) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

export function errorBody(code: ErrorCode): { error: { code: string; message: string } } {
  return { error: { code, message: ERROR_MESSAGES[code] } };
}

export function throwApi(status: number, code: ErrorCode, headers?: Record<string, string>): never {
  throw new ApiError(status, code, headers);
}
