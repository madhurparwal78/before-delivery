// The one error mechanism: every API error is an ApiError, rendered by the router as the brief's error shape.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : "validation");
  }
}

export const fail = (status: number, code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(status, { error: code, ...extra });

export const notFound = (): ApiError => fail(404, "not_found");
export const forbidden = (): ApiError => fail(403, "forbidden");
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError => fail(409, code, extra);
export const paymentsUnavailable = (): ApiError => fail(503, "payments_unavailable");
export const storageUnavailable = (): ApiError => fail(503, "storage_unavailable");

export const isUnavailable = (error: unknown, code: "payments_unavailable" | "storage_unavailable"): boolean =>
  error instanceof ApiError && error.status === 503 && error.body.error === code;

/** Collects field errors so a 422 reports every invalid and unaccepted field at once. */
export class Validation {
  private readonly errors: Record<string, string> = {};

  constructor(body: Record<string, unknown>, accepted: readonly string[]) {
    for (const field of Object.keys(body)) {
      if (!accepted.includes(field)) this.errors[field] = "This field is not accepted.";
    }
  }

  add(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  has(field: string): boolean {
    return this.errors[field] !== undefined;
  }

  /** The 422 carrying every field error collected so far. */
  error(): ApiError {
    return new ApiError(422, { errors: { ...this.errors } });
  }

  /** Precedence step 8: throws the 422 when any field failed. */
  done(): void {
    if (Object.keys(this.errors).length > 0) throw this.error();
  }
}
