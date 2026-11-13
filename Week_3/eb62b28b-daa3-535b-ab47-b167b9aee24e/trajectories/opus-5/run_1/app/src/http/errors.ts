import { copy } from '../shared/copy';

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

/** The one published error shape, built in one place. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }

  body(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found', copy.notFound);

export const methodNotAllowed = (allow: string[]): ApiError =>
  new ApiError(405, 'method_not_allowed', 'That method is not allowed here.', undefined, {
    Allow: allow.join(', '),
  });

export const tooLarge = (message: string): ApiError => new ApiError(413, 'too_large', message);

export const rateLimited = (message: string, retryAfterSeconds: number): ApiError =>
  new ApiError(429, 'rate_limited', message, undefined, {
    'Retry-After': String(retryAfterSeconds),
  });

export const notSignedIn = (): ApiError =>
  new ApiError(401, 'not_signed_in', 'Sign in to keep going.');

export const sessionEnded = (): ApiError => new ApiError(401, 'session_ended', copy.sessionEnded);

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'This is not yours to see.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'Send the body in the published format.');

export const badRequest = (): ApiError =>
  new ApiError(400, 'bad_request', 'That request could not be read.');

export const requestKeyReused = (): ApiError =>
  new ApiError(409, 'request_key_reused', copy.requestKeyReused);

export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'invalid', 'Check the highlighted fields.', fields);

export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);

export const stale = (message: string): ApiError => new ApiError(412, 'stale', message);

export const gone = (): ApiError => new ApiError(410, 'visit_page_ended', copy.visitPageEnded);

export const paymentsUnavailable = (): ApiError =>
  new ApiError(503, 'payments_unavailable', copy.paymentsUnavailable);

export const reportStoreUnavailable = (): ApiError =>
  new ApiError(503, 'report_store_unavailable', copy.reportStoreUnavailable);

export const attachmentStoreUnavailable = (): ApiError =>
  new ApiError(503, 'attachment_store_unavailable', copy.attachmentStoreUnavailable);
