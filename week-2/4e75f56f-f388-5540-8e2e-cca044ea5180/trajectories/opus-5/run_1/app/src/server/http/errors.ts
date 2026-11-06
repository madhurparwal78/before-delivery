export type ErrorExtra = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ErrorExtra {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'This request came from another origin.');

export const payloadTooLarge = (): ApiError =>
  new ApiError(413, 'payload_too_large', 'The request body is larger than this endpoint allows.');

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidCredentials = (): ApiError =>
  new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'This account may not use this endpoint.');

export const malformedJson = (): ApiError =>
  new ApiError(400, 'malformed_json', 'The request body is not valid JSON.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'This endpoint expects a different content type.');

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'No such record.');

export const conflict = (code: string, message: string, extra: ErrorExtra = {}): ApiError =>
  new ApiError(409, code, message, extra);

export const invalidTransition = (): ApiError =>
  conflict('invalid_transition', 'That change is not allowed from this state.');

export const validation = (errors: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', 'Some fields need attention.', { errors });

export const fileTooLarge = (): ApiError =>
  new ApiError(413, 'file_too_large', 'Files must be 10,000,000 bytes or smaller.');

export const unsupportedFileType = (): ApiError =>
  new ApiError(415, 'unsupported_file_type', 'Upload a PDF, JPEG or PNG file.');

export const billingUnavailable = (): ApiError =>
  new ApiError(503, 'billing_unavailable', 'Kill Bill is not answering.');

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'Document storage is not answering.');

export const contentUnavailable = (): ApiError =>
  new ApiError(503, 'content_unavailable', 'The programme store is not answering.');
