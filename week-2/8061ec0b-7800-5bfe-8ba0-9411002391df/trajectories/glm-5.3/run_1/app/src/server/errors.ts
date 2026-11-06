// The one error shape (DP-45).
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  fields?: Record<string, string>;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  static unauthenticated(): ApiError {
    return new ApiError(401, "unauthenticated", "Sign in to use Bellroll.");
  }

  static forbidden(): ApiError {
    return new ApiError(403, "forbidden", "Your role cannot do that.");
  }

  static notFound(message = "Not found."): ApiError {
    return new ApiError(404, "not_found", message);
  }

  static validation(fields: Record<string, string>): ApiError {
    const err = new ApiError(422, "validation_failed", "Some fields need attention.");
    err.fields = fields;
    return err;
  }

  static validationWith(fields: Record<string, string>, extra: Record<string, unknown>): ApiError {
    const err = new ApiError(422, "validation_failed", "Some fields need attention.", extra);
    err.fields = fields;
    return err;
  }

  static conflict(code: string, message: string, extra?: Record<string, unknown>): ApiError {
    return new ApiError(409, code, message, extra);
  }

  static unavailable(dependency: "billing" | "storage"): ApiError {
    return dependency === "billing"
      ? new ApiError(503, "billing_unavailable", "Billing is unreachable. Nothing was changed.")
      : new ApiError(503, "storage_unavailable", "File storage is unreachable. Nothing was changed.");
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.extra) {
      for (const [key, value] of Object.entries(this.extra)) error[key] = value;
    }
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}
