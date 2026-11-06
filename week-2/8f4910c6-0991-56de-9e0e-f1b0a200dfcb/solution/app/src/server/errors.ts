// The one API error shape: `{"error": "<code>", ...extra}`.

export type ErrorExtra = Record<string, string | number | null | Record<string, string>>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: ErrorExtra = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found");
export const forbidden = (): ApiError => new ApiError(403, "forbidden");
export const conflict = (code: string, extra: ErrorExtra = {}): ApiError => new ApiError(409, code, extra);
export const gone = (code: string): ApiError => new ApiError(410, code);
export const billingUnavailable = (): ApiError => new ApiError(503, "billing_unavailable");
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable");

export function staleVersion(savedBy: string, savedAt: Date): ApiError {
  return new ApiError(412, "stale_version", { savedBy, savedAt: isoInstant(savedAt) });
}

/** Field errors collected in request order; thrown as one 422. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!(field in this.errors)) this.errors[field] = copy;
  }

  has(field: string): boolean {
    return field in this.errors;
  }

  any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  fail(): never {
    throw new ApiError(422, "validation", { errors: { ...this.errors } });
  }

  throwIfAny(): void {
    if (this.any()) this.fail();
  }
}

export function validation(field: string, copy: string): ApiError {
  return new ApiError(422, "validation", { errors: { [field]: copy } });
}

/** ISO 8601 UTC with whole seconds and a Z. */
export function isoInstant(value: Date | number): string {
  const ms = typeof value === "number" ? value : value.getTime();
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function optionalInstant(value: Date | null): string | null {
  return value ? isoInstant(value) : null;
}

export const required = (label: string): string => `Enter ${label.toLowerCase()}.`;
export const EMAIL_COPY = "Enter an email address like name@example.com.";
