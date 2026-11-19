// The one published error shape and precedence for the whole API.

export type ErrorBody = Record<string, unknown> & { error: string };

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.body = { error: code, ...extra };
  }
}

export const tooLarge = (): ApiError => new ApiError(413, 'too_large');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const badOrigin = (): ApiError => new ApiError(403, 'bad_origin');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const readOnly = (): ApiError => new ApiError(403, 'read_only');
export const serverError = (): ApiError => new ApiError(500, 'server_error');

export function invalidField(field: string): ApiError {
  return new ApiError(422, 'invalid_field', { field });
}
