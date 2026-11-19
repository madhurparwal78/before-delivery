export type ErrorExtras = Record<string, unknown>;

/** The single error shape every failure leaves the server through. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;

  constructor(status: number, code: string, extras: ErrorExtras = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }

  body(): ErrorExtras {
    return { error: this.code, ...this.extras };
  }
}

export const tooLarge = (): ApiError => new ApiError(413, 'too_large');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const conflict = (code: string, extras: ErrorExtras = {}): ApiError =>
  new ApiError(409, code, extras);
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', { fields });
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
export const directoryUnavailable = (): ApiError => new ApiError(503, 'directory_unavailable');
export const linkExpired = (): ApiError => new ApiError(410, 'link_expired');
