import { ERROR_COPY } from '../../domain/copy.ts';

export type ErrorExtra = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    extra: ErrorExtra = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }

  get body(): { error: ErrorExtra } & ErrorExtra {
    const { message, ...rest } = this.extra;
    return {
      error: {
        code: this.code,
        message: typeof message === 'string' ? message : (ERROR_COPY[this.code] ?? this.code),
      },
      ...rest,
    };
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');

export const methodNotAllowed = (allow: readonly string[]): ApiError =>
  new ApiError(405, 'method_not_allowed', {}, { allow: allow.join(', ') });

export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');

export const forbidden = (): ApiError => new ApiError(403, 'forbidden');

export const unauthenticated = (code: 'unauthenticated' | 'session_ended' | 'access_removed'): ApiError =>
  new ApiError(401, code);

export const tooLarge = (message?: string): ApiError =>
  new ApiError(413, 'too_large', message === undefined ? {} : { message });

export const unsupportedMediaType = (message?: string): ApiError =>
  new ApiError(415, 'unsupported_media_type', message === undefined ? {} : { message });

export const invalidJson = (): ApiError => new ApiError(400, 'invalid_json');

export const conflict = (code: string, extra: ErrorExtra = {}): ApiError =>
  new ApiError(409, code, extra);

export const gone = (code: string, extra: ErrorExtra = {}): ApiError => new ApiError(410, code, extra);

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', { fields });

export const staleVersion = (
  savedBy: string,
  savedAtInstant: string,
  current: unknown,
  message: string,
): ApiError =>
  new ApiError(412, 'stale_version', { savedBy, savedAt: savedAtInstant, current, message });

export const rateLimited = (retryAfterSeconds: number, message: string): ApiError =>
  new ApiError(
    429,
    'rate_limited',
    { retryAfterSeconds, message },
    { 'retry-after': String(retryAfterSeconds) },
  );

export const billingUnavailable = (): ApiError => new ApiError(503, 'billing_unavailable');

export const storageUnavailable = (message?: string): ApiError =>
  new ApiError(503, 'storage_unavailable', message === undefined ? {} : { message });
