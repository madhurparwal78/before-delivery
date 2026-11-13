import { COPY } from "../shared/copy.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "That does not exist.");
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation", "Some values need fixing.", { fields });
export const unavailable = (): ApiError => new ApiError(503, "unavailable", COPY.unavailable);
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable", COPY.storageOutage);
