import type { Pin } from '../shared/types.js';

export type ErrorBody = Record<string, unknown> & { error: string };

/** The one API error shape. Every failure is raised as one of these. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export const unauthorized = (): ApiError => new ApiError(401, { error: 'unauthorized' });
export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });
export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });
export const unsupportedType = (): ApiError => new ApiError(415, { error: 'unsupported_type' });
export const tooLarge = (maxBytes: number): ApiError =>
  new ApiError(413, { error: 'too_large', max_bytes: maxBytes });
export const validation = (field: string): ApiError =>
  new ApiError(422, { error: 'validation', field });
export const storageUnavailable = (): ApiError =>
  new ApiError(503, { error: 'storage_unavailable' });
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });
export const gone = (code: string): ApiError => new ApiError(410, { error: code });
export const versionConflict = (current: Pin): ApiError =>
  new ApiError(409, { error: 'version_conflict', current });
export const invalidCredentials = (): ApiError =>
  new ApiError(401, { error: 'invalid_credentials' });
