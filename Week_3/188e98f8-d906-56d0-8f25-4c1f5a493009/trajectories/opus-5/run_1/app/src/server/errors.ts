/** The one error shape and status mapping every failure leaves the server through. */

import type { ApiError } from '../shared/model.js';

export type FieldVerdict = 'required' | 'too_long' | 'invalid' | 'too_deep';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
    this.name = 'ApiFailure';
  }
}

export const notFound = (): ApiFailure => new ApiFailure(404, { error: 'not_found' });
export const methodNotAllowed = (allow: string): ApiFailure =>
  new ApiFailure(405, { error: 'method_not_allowed' }, { Allow: allow });
export const tooLarge = (): ApiFailure => new ApiFailure(413, { error: 'too_large' });
export const unsupportedMediaType = (): ApiFailure => new ApiFailure(415, { error: 'unsupported_media_type' });
export const badJson = (): ApiFailure => new ApiFailure(400, { error: 'bad_json' });
export const signedOut = (): ApiFailure => new ApiFailure(401, { error: 'signed_out' });
export const badCode = (): ApiFailure => new ApiFailure(401, { error: 'bad_code' });
export const forbidden = (): ApiFailure => new ApiFailure(403, { error: 'forbidden' });
export const conflict = (code: string, count?: number): ApiFailure =>
  new ApiFailure(409, count === undefined ? { error: code } : { error: code, count });
export const invalidFields = (fields: Record<string, FieldVerdict>): ApiFailure =>
  new ApiFailure(422, { error: 'invalid', fields });
export const tooManySubmits = (retryAfter: number): ApiFailure =>
  new ApiFailure(
    429,
    { error: 'too_many_submits', retry_after: retryAfter },
    { 'Retry-After': String(retryAfter) },
  );
export const storageUnavailable = (): ApiFailure => new ApiFailure(503, { error: 'storage_unavailable' });
export const searchTimeout = (): ApiFailure => new ApiFailure(503, { error: 'search_timeout' });
