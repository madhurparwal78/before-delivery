// One error shape for every API answer: `{"error": "<code>", ...extra}`.

type ErrorExtra = Record<string, string | number | null | Record<string, string>>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(code);
  }

  get body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export function fail(status: number, code: string, extra: ErrorExtra = {}): ApiError {
  return new ApiError(status, code, extra);
}

export const notFound = (): ApiError => fail(404, "not_found");

export function invalid(errors: Record<string, string>): ApiError {
  return fail(422, "validation", { errors });
}

/** Collects field messages; `throwIfAny` raises them as one 422. */
export class FieldErrors {
  private readonly messages: Record<string, string> = {};

  add(field: string, message: string): void {
    this.messages[field] ??= message;
  }

  get empty(): boolean {
    return Object.keys(this.messages).length === 0;
  }

  error(): ApiError {
    return invalid(this.messages);
  }

  throwIfAny(): void {
    if (!this.empty) throw this.error();
  }
}
