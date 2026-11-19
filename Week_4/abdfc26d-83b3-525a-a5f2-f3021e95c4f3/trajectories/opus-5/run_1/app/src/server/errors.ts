export type ErrorCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'idempotency_key_reused'
  | 'idempotency_in_progress'
  | 'version_required'
  | 'version_conflict'
  | 'invalid_transition'
  | 'edition_taken'
  | 'hold_expired'
  | 'own_piece'
  | 'remix_of_remix'
  | 'plan_exists'
  | 'plan_not_confirmed'
  | 'refund_window_closed'
  | 'invoice_pending'
  | 'period_open'
  | 'period_closed'
  | 'validation_failed'
  | 'insufficient_credits'
  | 'provider_unavailable'
  | 'payments_unavailable'
  | 'storage_unavailable'
  | 'provider_malformed';

export type FieldErrors = Readonly<Record<string, string>>;

/** Extra members merged into the error object, as the API defines per code. */
export type ErrorDetail = Readonly<Record<string, string | number | null>>;

interface ApiErrorBodyError {
  code: ErrorCode;
  message: string;
  fields?: FieldErrors;
  [detail: string]: string | number | null | FieldErrors | undefined;
}

export interface ApiErrorBody {
  error: ApiErrorBodyError;
}

/** The single error type for the whole API; it is the only source of error bodies. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;
  readonly detail?: ErrorDetail;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { fields?: FieldErrors; detail?: ErrorDetail },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options?.fields) this.fields = options.fields;
    if (options?.detail) this.detail = options.detail;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBodyError = { code: this.code, message: this.message };
    if (this.detail) Object.assign(error, this.detail);
    if (this.fields) error.fields = this.fields;
    return { error };
  }

  static payloadTooLarge(message: string): ApiError {
    return new ApiError(413, 'payload_too_large', message);
  }

  static unsupportedMediaType(): ApiError {
    return new ApiError(415, 'unsupported_media_type', 'Send this request as application/json.');
  }

  static unauthenticated(): ApiError {
    return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }

  /** Unknown ids and other users' private resources answer with one identical body. */
  static notFound(): ApiError {
    return new ApiError(404, 'not_found', 'Not found.');
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static validation(fields: FieldErrors): ApiError {
    return new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { fields });
  }

  static invalidTransition(message: string): ApiError {
    return new ApiError(409, 'invalid_transition', message);
  }

  static versionRequired(): ApiError {
    return new ApiError(428, 'version_required', 'Send the piece version in If-Match.');
  }

  static versionConflict(currentVersion: number): ApiError {
    return new ApiError(412, 'version_conflict', 'This piece changed in another tab.', {
      detail: { current_version: currentVersion },
    });
  }

  static insufficientCredits(needed: number, available: number): ApiError {
    return new ApiError(402, 'insufficient_credits', 'This render needs more credits than you have.', {
      detail: { needed, available },
    });
  }

  static paymentsUnavailable(): ApiError {
    return new ApiError(503, 'payments_unavailable', 'Payments are offline right now.');
  }

  static storageUnavailable(): ApiError {
    return new ApiError(503, 'storage_unavailable', 'File storage is offline right now.');
  }

  static providerUnavailable(): ApiError {
    return new ApiError(503, 'provider_unavailable', 'The shader assistant is offline.');
  }

  static providerMalformed(): ApiError {
    return new ApiError(502, 'provider_malformed', "The shader assistant sent something we can't run.");
  }
}
