/**
 * Every API error is produced here, in one shape, with no internals in it.
 */

export type ErrorCode =
  | 'notFound'
  | 'methodNotAllowed'
  | 'tooLarge'
  | 'foreignOrigin'
  | 'rateLimited'
  | 'notSignedIn'
  | 'sessionEnded'
  | 'ended'
  | 'unsupportedMediaType'
  | 'malformedJson'
  | 'validationFailed'
  | 'conflict'
  | 'alreadySignedOff'
  | 'estimateReplaced'
  | 'staleEdit'
  | 'providerUnavailable';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  /** Whole seconds, for a 429. */
  readonly retryAfter: number | undefined;
  /** For a 405. */
  readonly allow: string | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extra: { fields?: Record<string, string>; retryAfter?: number; allow?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.retryAfter = extra.retryAfter;
    this.allow = extra.allow;
  }

  get body(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const fail = {
  notFound: (): ApiError => new ApiError(404, 'notFound', 'Not found.'),
  methodNotAllowed: (allow: string): ApiError =>
    new ApiError(405, 'methodNotAllowed', 'That method is not allowed here.', { allow }),
  tooLarge: (message: string): ApiError => new ApiError(413, 'tooLarge', message),
  foreignOrigin: (): ApiError =>
    new ApiError(403, 'foreignOrigin', 'That request did not come from this app.'),
  rateLimited: (message: string, retryAfter: number): ApiError =>
    new ApiError(429, 'rateLimited', message, { retryAfter: Math.max(0, Math.ceil(retryAfter)) }),
  notSignedIn: (message: string): ApiError => new ApiError(401, 'notSignedIn', message),
  sessionEnded: (message: string): ApiError => new ApiError(401, 'sessionEnded', message),
  ended: (message: string): ApiError => new ApiError(410, 'ended', message),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupportedMediaType', 'That content type is not supported here.'),
  malformedJson: (): ApiError => new ApiError(400, 'malformedJson', 'That body is not valid JSON.'),
  fields: (fields: Record<string, string>): ApiError => {
    const first = Object.values(fields)[0] ?? 'That value is not allowed.';
    return new ApiError(422, 'validationFailed', first, { fields });
  },
  invalid: (message: string): ApiError => new ApiError(422, 'validationFailed', message),
  conflict: (message: string): ApiError => new ApiError(409, 'conflict', message),
  conflictCode: (code: ErrorCode, message: string): ApiError => new ApiError(409, code, message),
  stale: (message: string): ApiError => new ApiError(412, 'staleEdit', message),
  unavailable: (message: string): ApiError => new ApiError(503, 'providerUnavailable', message),
};
