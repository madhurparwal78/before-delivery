// The one published error shape: {"error","message"} plus `fields` or `retry_after_seconds`.
// Every refusal the server sends is an HttpError built here, with copy from the feedback registry; the one
// exception is the grading seed failure, whose message the brief defines as "what was missing".

import { F } from "../shared/feedback.js";
import type { ApiError } from "../shared/types.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly copy: string,
    readonly extra: { fields?: Record<string, string>; retryAfter?: number; allow?: string[] } = {},
    /** Provider errors are never stored for command replay. */
    readonly provider = false,
  ) {
    super(`${status} ${code}`);
  }

  body(): ApiError {
    const body: ApiError = { error: this.code, message: this.copy };
    if (this.extra.fields) body.fields = this.extra.fields;
    if (this.extra.retryAfter !== undefined) body.retry_after_seconds = this.extra.retryAfter;
    return body;
  }
}

export const badRequest = () => new HttpError(400, "bad_request", F.BAD_BODY);
export const tooLarge = (fields?: Record<string, string>) => new HttpError(413, "too_large", F.TOO_LARGE, { fields });
export const unsupported = () => new HttpError(415, "unsupported_media_type", F.BAD_BODY);
export const methodNotAllowed = (allow: string[]) =>
  new HttpError(405, "method_not_allowed", F.BAD_BODY, { allow });
export const notFound = () => new HttpError(404, "not_found", F.HIDDEN);
export const unauthenticated = () => new HttpError(401, "authentication_required", F.SESSION);
export const forbidden = () => new HttpError(403, "forbidden", F.FORBIDDEN);
export const stepUpRequired = () => new HttpError(403, "step_up_required", F.MFA_REQUIRED);
export const conflict = (copy: string) => new HttpError(409, "conflict", copy);
export const invalid = (fields: Record<string, string>) => new HttpError(422, "invalid", F.INVALID, { fields });

export const seedFailed = (missing: string) => new HttpError(500, "seed_failed", missing);

export const serviceUnavailable = () => new HttpError(503, "service_unavailable", F.SERVICE, {}, true);
export const catalogUnavailable = () => new HttpError(503, "catalog_unavailable", F.CATALOG_WAIT, {}, true);
export const catalogBusy = (seconds: number) =>
  new HttpError(429, "catalog_busy", F.CATALOG_RATE, { retryAfter: seconds }, true);
export const catalogMalformed = () => new HttpError(502, "catalog_malformed", F.CATALOG_BAD, {}, true);
export const catalogMissing = () => new HttpError(502, "catalog_missing", F.CATALOG_MISSING, {}, true);

/** Collects 422 field errors so a request reports every invalid field at once. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};
  private oversized = false;

  add(field: string, copy: string): void {
    if (!(field in this.fields)) this.fields[field] = copy;
  }

  /** A photograph over FLAN_UPLOAD_MAX_BYTES turns the 422 into the step-6 413. */
  addOversized(field: string, copy: string): void {
    this.oversized = true;
    this.add(field, copy);
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length === 0) return;
    throw this.oversized ? tooLarge(this.fields) : invalid(this.fields);
  }
}
