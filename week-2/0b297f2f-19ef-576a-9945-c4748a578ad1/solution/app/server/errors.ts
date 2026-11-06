// The one error shape (brief: API, Error shape).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const notFound = () => new ApiError(404, "not_found", "Nothing is here.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role can't do that.");
export const databaseUnavailable = () =>
  new ApiError(503, "database_unavailable", "Hangline can't reach its database. Changes are paused until it's back.");
export const imageStoreUnavailable = () =>
  new ApiError(503, "image_store_unavailable", "Image store unavailable. Condition photos can't be attached right now.");

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", "Some fields need fixing.", { fields });
}
