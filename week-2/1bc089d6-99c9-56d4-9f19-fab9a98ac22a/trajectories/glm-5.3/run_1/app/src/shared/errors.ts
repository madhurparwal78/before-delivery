// One error shape for the whole API.
export type FieldErrors = Record<string, string>;

export const ERROR_MESSAGES = {
  invalid_json: 'The request body is not valid JSON.',
  idempotency_key_required: 'Send an Idempotency-Key header of 8 to 64 characters.',
  signed_out: 'Sign in to manage your hour.',
  cross_origin: 'This request did not come from Stillhour.',
  not_found: 'Nothing is here.',
  no_plan: 'There is no confirmed hour for this address.',
  link_unknown: 'We do not recognise this link.',
  method_not_allowed: 'This method is not allowed here.',
  idempotency_conflict: 'This Idempotency-Key was already used with a different hour.',
  version_conflict: 'This hour changed since you loaded it.',
  link_used: 'This link has already been used.',
  link_expired: 'This link has expired.',
  too_large: 'The request is larger than 16,384 bytes.',
  unsupported_media_type: 'Send the request body as JSON.',
  invalid: 'Some details need another look.',
  version_required: 'Send the version you are editing in an If-Match header.',
  rate_limited: 'Too many requests for this address. Try again later.',
  internal: 'Something went wrong on our side. Please try again.',
  unavailable: 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const STATUS_FOR: Record<ErrorCode, number> = {
  invalid_json: 400,
  idempotency_key_required: 400,
  signed_out: 401,
  cross_origin: 403,
  not_found: 404,
  no_plan: 404,
  link_unknown: 404,
  method_not_allowed: 405,
  idempotency_conflict: 409,
  version_conflict: 409,
  link_used: 410,
  link_expired: 410,
  too_large: 413,
  unsupported_media_type: 415,
  invalid: 422,
  version_required: 428,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;
  readonly current?: unknown;
  readonly retryAfter?: number;

  constructor(code: ErrorCode, opts: { fields?: FieldErrors; current?: unknown; retryAfter?: number } = {}) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.status = STATUS_FOR[code];
    this.fields = opts.fields;
    this.current = opts.current;
    this.retryAfter = opts.retryAfter;
  }

  body(): object {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.current !== undefined) error.current = this.current;
    return { error };
  }
}

export function fieldErrors(code: keyof typeof ERROR_MESSAGES, fields: FieldErrors): ApiError {
  return new ApiError(code, { fields });
}
