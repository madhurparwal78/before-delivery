import type { ErrorBody, FieldError } from "../shared/api-types";

/** Every refusal leaves the server as one of these, in one body shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
  }
}

export const notFound = () => new ApiError(404, { error: "not_found" });
export const forbidden = () => new ApiError(403, { error: "forbidden" });
export const badCode = () => new ApiError(401, { error: "bad_code" });
export const conflict = (error: string, count?: number) =>
  new ApiError(409, count === undefined ? { error } : { error, count });
export const unavailable = (error: "storage_unavailable" | "search_timeout") => new ApiError(503, { error });
export const invalid = (fields: Record<string, FieldError>) => new ApiError(422, { error: "invalid", fields });
export const tooManySubmits = (retryAfter: number) =>
  new ApiError(429, { error: "too_many_submits", retry_after: retryAfter }, { "Retry-After": String(retryAfter) });

/** Collects every failing field of a request, then refuses once. */
export class Fields {
  private readonly found: Record<string, FieldError> = {};
  set(field: string, value: FieldError): void {
    this.found[field] ??= value;
  }
  get empty(): boolean {
    return Object.keys(this.found).length === 0;
  }
  assertEmpty(): void {
    if (!this.empty) throw invalid(this.found);
  }
}
