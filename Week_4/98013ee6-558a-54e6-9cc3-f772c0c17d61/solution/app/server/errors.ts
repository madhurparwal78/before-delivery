type ErrorBody = { error: string } & Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

export const unauthorized = (): ApiError => new ApiError(401, { error: "unauthorized" });
export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const tooLarge = (maxBytes: number): ApiError => new ApiError(413, { error: "too_large", max_bytes: maxBytes });
export const unsupportedType = (): ApiError => new ApiError(415, { error: "unsupported_type" });
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });
export const gone = (code: string): ApiError => new ApiError(410, { error: code });
export const validation = (field: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(422, { error: "validation", field, ...extra });
export const invalidCredentials = (): ApiError => new ApiError(401, { error: "invalid_credentials" });
export const internalError = (): ApiError => new ApiError(500, { error: "internal" });
export const storageUnavailable = (): ApiError => new ApiError(503, { error: "storage_unavailable" });
