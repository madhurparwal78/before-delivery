import type { Json } from "./json.js";

/** Every /api error goes through this one shape: {"code"} plus the extra fields the brief names. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: { code: string } & Record<string, Json>;

  constructor(status: number, code: string, extra: Record<string, Json> = {}) {
    super(code);
    this.status = status;
    this.body = { code, ...extra };
  }
}

export const unauthenticated = () => new ApiError(401, "unauthenticated");
export const notFound = () => new ApiError(404, "not_found");
export const forbidden = () => new ApiError(403, "forbidden");
export const invalidTransition = (from: string, to: string) => new ApiError(409, "invalid_transition", { from, to });
export const storageUnavailable = () => new ApiError(503, "storage_unavailable");

export function validationFailed(errors: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", { errors });
}

/** Collects field errors so a handler can report them all at once. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationFailed(this.errors);
  }
}
