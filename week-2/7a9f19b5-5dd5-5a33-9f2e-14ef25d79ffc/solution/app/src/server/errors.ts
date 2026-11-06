// Every API error is an ApiError and is written by the router in the one shape the brief publishes:
// {"error":"<code>"}, plus "errors" for 422 and the extra fields a specific endpoint row names.
import type { ApiErrorBody } from "../shared/types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }
}

export function apiError(status: number, code: string, extra: Omit<ApiErrorBody, "error"> = {}): ApiError {
  return new ApiError(status, { error: code, ...extra });
}

export const notFound = (code = "not_found") => apiError(404, code);
/** The brief's 409 for a change the current status does not allow; `status` is what the record reports. */
export const invalidState = (status: string) => apiError(409, "invalid_state", { status });
export const validation = (errors: Record<string, string>) => apiError(422, "validation_failed", { errors });

/** What a log line may say about an error: its code or name, never a message that could carry a host or port. */
export function errorCode(error: unknown): string {
  if (error instanceof ProviderUnavailable) return error.message;
  if (error instanceof Error) return (error as NodeJS.ErrnoException).code ?? error.name;
  return "unknown";
}

type ProviderName = "killbill" | "minio" | "pocketbase";

/** A provider that could not be reached (no connection, no reply within the timeout, or a failed reply). */
export class ProviderUnavailable extends Error {
  constructor(
    readonly provider: ProviderName,
    detail: string,
  ) {
    super(`${provider} unavailable: ${detail}`);
  }
}
