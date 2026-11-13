// The one error shape: {"error","message"} plus the extra fields a row names.
import { display } from "../shared/numbers";
import type { Diagnostic } from "../shared/tine";

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
}

/** Object storage did not answer; the route decides which outage copy the 503 carries. */
export class StorageUnavailable extends Error {}

export class MailUnavailable extends Error {}

export { DOWNLOAD_OUTAGE, SAVE_OUTAGE } from "../shared/copy";

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const notFound = () => new ApiError(404, "not_found", "Not found.");
export const forbidden = () => new ApiError(403, "forbidden", "You can't do that on this part.");

export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(422, "invalid", "Check the highlighted fields.", { errors });
}

export function tooLarge(limit: number): ApiError {
  return new ApiError(413, "too_large", `Request body is larger than ${display(limit, 0)} bytes.`);
}

export function evaluationFailed(diagnostics: Diagnostic[]): ApiError {
  return new ApiError(422, "evaluation_failed", diagnostics[0]?.message ?? "The part does not evaluate.", { diagnostics });
}

export function storageOutage(copy: string): ApiError {
  return new ApiError(503, "storage_unavailable", copy, {}, { "Retry-After": "5" });
}
