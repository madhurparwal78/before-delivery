export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { code: this.code, ...this.extra };
  }
}

export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');
export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials');

export const tooManyAttempts = (retryAfter: number): ApiError =>
  new ApiError(429, 'too_many_attempts', { retry_after: retryAfter }, {
    'retry-after': String(retryAfter),
  });

export const validationFailed = (errors: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', { errors });

export const stockConflict = (
  storeId: string,
  sku: string,
  remaining: number,
): ApiError => new ApiError(409, 'stock_conflict', { store_id: storeId, sku, remaining });

export const storeSuspended = (storeId: string): ApiError =>
  new ApiError(409, 'store_suspended', { store_id: storeId });

export const holdActive = (holdId: string): ApiError =>
  new ApiError(409, 'hold_active', { hold_id: holdId });

export const holdExpired = (holdId: string): ApiError =>
  new ApiError(409, 'hold_expired', { hold_id: holdId });

export const slotUnavailable = (): ApiError => new ApiError(409, 'slot_unavailable');
export const requestKeyReuse = (): ApiError => new ApiError(409, 'request_key_reuse');
export const requestInProgress = (): ApiError => new ApiError(409, 'request_in_progress');
export const storageUnavailableError = (): ApiError => new ApiError(503, 'storage_unavailable');

export const belowHeld = (held: number): ApiError =>
  new ApiError(409, 'below_held', { held });

export const invalidTransition = (from: string, to: string): ApiError =>
  new ApiError(409, 'invalid_transition', { from, to });

export const sequenceBroken = (firstBadSeq: number): ApiError =>
  new ApiError(409, 'sequence_broken', { first_bad_seq: firstBadSeq });
