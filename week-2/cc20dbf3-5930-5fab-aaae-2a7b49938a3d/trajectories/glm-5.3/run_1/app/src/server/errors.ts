export type ErrorCode =
  | "unauthenticated"
  | "bad_credentials"
  | "forbidden"
  | "not_found"
  | "cross_origin"
  | "unsupported_media_type"
  | "body_too_large"
  | "validation"
  | "no_unit_free"
  | "unit_busy"
  | "hold_expired"
  | "borrowing_paused"
  | "borrowing_limit"
  | "renewal_used"
  | "invalid_transition"
  | "idempotency_conflict"
  | "request_in_progress"
  | "photo_limit"
  | "unsupported_photo"
  | "photo_too_large"
  | "not_settled"
  | "settlement_mismatch"
  | "billing_unavailable"
  | "photo_storage_unavailable";

export function conflict(code: ErrorCode): ApiError {
  return new ApiError(409, code);
}

export const COPY: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  bad_credentials: "Email or password is wrong.",
  forbidden: "Your role can't do that.",
  not_found: "Not found.",
  cross_origin: "Cross-site requests are refused.",
  unsupported_media_type: "Send JSON, or a multipart form for photos.",
  body_too_large: "Request body is too large.",
  validation: "Check the highlighted fields.",
  no_unit_free: "No unit is free for these dates.",
  unit_busy: "That unit is busy on some of those days.",
  hold_expired: "This hold's pickup window has closed.",
  borrowing_paused: "Borrowing is paused while an item is overdue.",
  borrowing_limit: "You can have at most 4 items held or out at once.",
  renewal_used: "This loan has already been renewed once.",
  invalid_transition: "This record can't do that.",
  idempotency_conflict: "That Idempotency-Key was used for a different request.",
  request_in_progress: "That request is still being processed.",
  photo_limit: "This stage already has 4 photos.",
  unsupported_photo: "Photos must be JPEG, PNG or WebP.",
  photo_too_large: "Photos can be at most 5,000,000 bytes.",
  not_settled: "This loan isn't settled yet.",
  settlement_mismatch: "An earlier attempt fixed this loan's damage charge at a different amount. Settle again with that amount.",
  billing_unavailable: "Billing is offline right now. Try again in a moment.",
  photo_storage_unavailable: "Photo storage is offline. Try again in a moment.",
};

export const FIELD_COPY = {
  start_date: "Choose an open day from today, within the next 28 days.",
  end_date: "Choose an open day on or after pickup, at most 7 days later.",
  due_date: "Choose an open day on or after checkout, at most 7 days later.",
  renewal_due_date: "Choose an open day after the current due date, at most 7 days after it.",
  checked_out_at: "Checkout time can't be in the future.",
  returned_at: "Return time must be after checkout and not in the future.",
  outcome: "Choose OK or Damaged.",
  note_damaged: "Describe the damage in up to 500 characters.",
  note_ok: "Notes can be up to 500 characters.",
  damage_cents_ok: "An item inspected OK has no damage charge.",
  damage_cents_range: "Damage charge must be whole cents from $0.00 to the item's replacement value.",
  item_id: "No such item.",
  member_id: "No such member.",
  unit_id: "No such unit.",
  hold_id: "No such hold.",
  idempotency_key: "Send an Idempotency-Key header of 1 to 100 characters.",
  limit: "Choose a page size from 1 to 50.",
  cursor: "This page link is out of date. Start from the first page.",
  email: "Required.",
  password: "Required.",
  photo: "Required.",
  from: "Choose a date in YYYY-MM-DD form.",
} as const;

export type FieldName = keyof typeof FIELD_COPY;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: ErrorCode, fields?: Record<string, string>) {
    super(COPY[code]);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): string {
    const error: Record<string, unknown> = { code: this.code, message: messageFor(this) };
    if (this.fields && Object.keys(this.fields).length > 0) {
      error.fields = this.fields;
    }
    return JSON.stringify({ error });
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated");
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden");
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found");
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation", fields);
}

export function invalidTransition(recordKind: "hold" | "loan", statusWord: string): ApiError {
  const message = `This ${recordKind} is ${statusWord} and can't do that.`;
  const err = new ApiError(409, "invalid_transition");
  (err as { customMessage?: string }).customMessage = message;
  return err;
}

export function settlementMismatch(money: string): ApiError {
  const message = `An earlier attempt fixed this loan's damage charge at ${money}. Settle again with that amount.`;
  const err = new ApiError(409, "settlement_mismatch");
  (err as { customMessage?: string }).customMessage = message;
  return err;
}

export function outage(code: "billing_unavailable" | "photo_storage_unavailable", message: string): ApiError {
  const err = new ApiError(503, code);
  (err as { customMessage?: string }).customMessage = message;
  return err;
}

export function messageFor(err: ApiError): string {
  return (err as { customMessage?: string }).customMessage ?? COPY[err.code];
}
