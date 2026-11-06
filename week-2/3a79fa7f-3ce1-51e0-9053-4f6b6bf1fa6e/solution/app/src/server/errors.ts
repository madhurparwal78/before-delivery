// Every error body of the API is built here, in the one shape { error, message, fields? }.
const CATALOGUE = {
  bad_request: [400, "The request body is not valid JSON."],
  idempotency_key_required: [400, "Send an Idempotency-Key header of 8 to 64 characters."],
  unauthorized: [401, "Please sign in."],
  invalid_credentials: [401, "Email or password is incorrect."],
  forbidden: [403, "You do not have access to this."],
  not_found: [404, "Not found."],
  method_not_allowed: [405, "Method not allowed."],
  idempotency_in_progress: [409, "This order is still being placed. Retry with the same key."],
  idempotency_conflict: [409, "This key was already used for a different order."],
  out_of_stock: [409, "This size is out of stock."],
  illegal_transition: [409, "This order cannot be changed now."],
  quote_expired: [409, "This quote has expired."],
  open_trade_in: [409, "You already have an open trade-in."],
  slot_full: [409, "This demo day is fully booked."],
  already_booked: [409, "You already hold a seat at this time."],
  booking_closed: [409, "Booking for this demo day has closed."],
  too_late: [409, "Bookings can be cancelled up to 24 hours before the start."],
  not_started: [409, "This demo day has not started yet."],
  code_already_applied: [409, "This code is already applied."],
  email_taken: [409, "An account with this email already exists."],
  too_many_requests: [409, "You already have two callbacks booked."],
  already_protected: [409, "This board is already protected."],
  already_applied: [409, "This email has already applied."],
  not_delivered: [409, "Boards can be registered once the order is delivered."],
  nothing_to_register: [409, "Every board on this line is already registered."],
  already_registered: [409, "This board is already registered."],
  payload_too_large: [413, "The request body is too large."],
  unsupported_media_type: [415, "Send the request body as JSON."],
  unknown_field: [422, "This request has fields we do not accept."],
  validation_error: [422, "Check the highlighted fields."],
  unknown_board: [422, "Unknown board."],
  unknown_component: [422, "Unknown part."],
  incompatible: [422, "Not compatible."],
  limit: [422, "Limit per order."],
  invalid_code: [422, "This code is not valid."],
  too_many_codes: [422, "Only two codes can be used."],
  unsupported_country: [422, "We do not ship to this country yet."],
  empty_cart: [422, "Your cart is empty."],
  credit_unavailable: [422, "This credit is not available."],
  trade_in_not_applicable: [422, "Trade-in credit applies to Crest boards only."],
  not_eligible: [422, "Protection is available for boards only."],
  window_closed: [422, "Protection can be added within 30 days of your order."],
  invalid_token: [422, "This reset link is invalid or has expired."],
  too_many_attempts: [429, "Too many attempts. Try again later."],
  internal_error: [500, "Something went wrong."],
  billing_unavailable: [503, "Billing is unavailable. Your order was not placed."],
} as const satisfies Record<string, readonly [number, string]>;

type ErrorCode = keyof typeof CATALOGUE;
export type Fields = Record<string, string>;

interface Options {
  message?: string;
  status?: number;
  fields?: Fields;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly fields: Fields | undefined;
  readonly headers: Record<string, string>;

  constructor(readonly code: ErrorCode, options: Options = {}) {
    const [status, message] = CATALOGUE[code];
    super(options.message ?? message);
    this.status = options.status ?? status;
    this.fields = options.fields;
    this.headers = options.headers ?? {};
  }

  body(): { error: string; message: string; fields?: Fields } {
    return this.fields ? { error: this.code, message: this.message, fields: this.fields } : { error: this.code, message: this.message };
  }
}

/** Raised when one or more fields fail validation; every invalid field is named at once. */
export function invalid(fields: Fields): ApiError {
  return new ApiError("validation_error", { fields });
}

/** Throws a validation error when any field was refused. */
export function assertValid(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw invalid(fields);
}

/** Refuses any top-level key outside `allowed`, naming each one. */
export function refuseUnknown(body: Record<string, unknown>, allowed: readonly string[], prefix = ""): Fields {
  const fields: Fields = {};
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fields[`${prefix}${key}`] = "Unknown field.";
  return fields;
}

export function unknownFields(fields: Fields): ApiError {
  return new ApiError("unknown_field", { fields });
}
