// The one error shape of the API (brief: API, Error shapes) and its codes with their Feedback states copy.

const STATUS = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  payload_too_large: 413,
  file_too_large: 413,
  unsupported_media_type: 415,
  unsupported_type: 415,
  email_taken: 409,
  studio_name_taken: 409,
  category_exists: 409,
  judging_started: 409,
  invalid_transition: 409,
  deadline_passed: 409,
  deadline_not_passed: 409,
  idempotency_key_reused: 409,
  screening_incomplete: 409,
  previous_round_not_confirmed: 409,
  panel_empty: 409,
  no_entries: 409,
  round_closed: 409,
  ballot_submitted: 409,
  ballot_incomplete: 409,
  final_not_confirmed: 409,
  payments_paused: 503,
  mail_unavailable: 503,
  storage_unavailable: 503,
} as const;

type ErrorCode = keyof typeof STATUS;

export const COPY = {
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "That email and password don't match.",
  forbidden: "Only the program director can do that.",
  not_found: "We couldn't find that.",
  invalid_transition: "That step isn't available in the current state.",
  payload_too_large: "That request is larger than the desk accepts.",
  unsupported_media_type: "Send the request as JSON.",
  file_too_large: "Images must be 8,000,000 bytes or smaller.",
  unsupported_type: "Upload a PNG or JPEG image.",
  email_taken: "An account already uses that email.",
  studio_name_taken: "Another studio already uses that name.",
  category_exists: "That category already exists in this program.",
  judging_started: "Judging has started, so dates and categories are locked.",
  idempotency_key_reused: "That payment key was already used for another entry.",
  screening_incomplete: "Screen every submitted entry before opening Round 1.",
  previous_round_not_confirmed: "Confirm Round 1 standings before opening the final round.",
  panel_empty: "Add at least one juror before opening.",
  no_entries: "There are no entries to judge in this round.",
  round_closed: "This round closed before your ballot arrived. It was not counted.",
  ballot_submitted: "Your ballot is already submitted.",
  final_not_confirmed: "Confirm the final round before publishing.",
  payments_paused: "Payments are paused. Your draft is saved — try again shortly.",
  refunds_paused: "Refunds are paused. Your entry is still submitted — try again shortly.",
  mail_unavailable: "We couldn't send your receipt, so nothing was charged. Your draft is saved — try again shortly.",
  storage_unavailable: "Image storage is unavailable. Your draft is saved — try the upload again shortly.",
  storage_unavailable_submit: "Image storage is unavailable, so nothing was charged. Your draft is saved — try again shortly.",
  storage_unavailable_open: "Storage is unavailable, so the round was not opened. Try again shortly.",
  deadline_passed: (label: string) => `Entries closed at ${label}.`,
  deadline_not_passed: (label: string) => `Entries are still open until ${label}.`,
  ballot_incomplete: (left: number) => `Score every entry before submitting. ${left} left.`,
  unreadable: "This file isn't a readable PNG or JPEG image.",
  dimensions: "Images must be 640 to 4,096 pixels on each side.",
  count: "An entry holds at most 6 images.",
  assets: "Add at least one case-study image.",
  idempotencyKey: "Send an Idempotency-Key header of 1 to 100 characters.",
  reason: "Give a reason of 1 to 300 characters.",
  scores: "Scores are whole numbers from 1 to 10.",
  jurorId: "Choose a juror.",
} as const;

type Extra = Record<string, string | number>;

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error ?? "validation"));
  }
}

function defaultMessage(code: ErrorCode): string {
  const copy: unknown = (COPY as Record<string, unknown>)[code];
  return typeof copy === "string" ? copy : COPY.invalid_transition;
}

/** A refusal with a code the brief defines; `message` is the Feedback states copy for the action. */
export function refuse(code: ErrorCode, message?: string, extra: Extra = {}): ApiError {
  return new ApiError(STATUS[code], { error: code, message: message ?? defaultMessage(code), ...extra });
}

/** 422 with one copy line per rejected field. */
export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

/** Collects field errors and throws them together as one 422. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, copy: string): void {
    this.errors[field] ??= copy;
  }

  check(ok: boolean, field: string, copy: string): void {
    if (!ok) this.add(field, copy);
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length) throw invalid(this.errors);
  }
}
