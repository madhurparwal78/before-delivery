/** The one error type and the one error body every API failure is rendered into. */

const STATUS = {
  payload_too_large: 413,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_reused: 409,
  invalid_transition: 409,
  seat_taken: 409,
  credential_invalid: 409,
  schedule_conflict: 409,
  fee_changed: 409,
  unsupported_type: 415,
  validation: 422,
  storage_unavailable: 503,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof STATUS;

export type FieldErrors = Record<string, string>;

interface ErrorExtras {
  fields?: FieldErrors;
  quote?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extras: ErrorExtras = {},
  ) {
    super(message);
  }

  get status(): number {
    return STATUS[this.code];
  }

  body(): { error: { code: ErrorCode; message: string } & ErrorExtras } {
    return { error: { code: this.code, message: this.message, ...this.extras } };
  }
}

export const notFound = (): ApiError => new ApiError("not_found", "Not found.");

export const forbidden = (): ApiError => new ApiError("forbidden", "You don't have access to this action.");

export const invalidTransition = (message = "This request can no longer change that way."): ApiError =>
  new ApiError("invalid_transition", message);

export function validation(fields: FieldErrors): ApiError {
  return new ApiError("validation", "Some fields need attention.", { fields });
}

export const storageUnavailable = (): ApiError =>
  new ApiError("storage_unavailable", "Certificate storage is unreachable. Nothing was saved or opened.");
