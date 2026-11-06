/** Every API failure is one of these two shapes, as the API section requires. */
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
    return { error: this.code, ...this.extra };
  }
}

export class ValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super('validation_failed');
    this.fields = fields;
  }

  body(): Record<string, unknown> {
    return { errors: this.fields };
  }
}

export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const invalidJson = (): ApiError => new ApiError(400, 'invalid_json');
export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large');
export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials');
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
export const mailUnavailable = (): ApiError => new ApiError(503, 'mail_unavailable');
