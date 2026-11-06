export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export class ValidationError extends Error {
  constructor(readonly errors: FieldErrors) {
    super('validation_failed');
  }
}

export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, code, extra);
export const versionRequired = (): ApiError => new ApiError(428, 'version_required');
export const staleVersion = (currentVersion: number): ApiError =>
  new ApiError(412, 'stale_version', { current_version: currentVersion });
export const paymentUnavailable = (): ApiError => new ApiError(503, 'payment_unavailable');
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
export const invalid = (errors: FieldErrors): ValidationError => new ValidationError(errors);
