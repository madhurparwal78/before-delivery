// The one API error shape: {"error":{"code","message", "fields"?, "limit"?}}.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { fields?: Record<string, string>; limit?: number } = {},
  ) {
    super(message);
  }

  body(): string {
    return JSON.stringify({ error: { code: this.code, message: this.message, ...this.extra } });
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "Not found.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role can't do that.");
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable", "File storage is unavailable.");
export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
export const payloadTooLarge = (limit: number): ApiError =>
  new ApiError(413, "payload_too_large", `The request is larger than ${limit} bytes.`, { limit });
