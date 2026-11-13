/** Every API error has the one published shape: {"error":"<CODE>"} plus the fields its row names. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const databaseUnavailable = (): ApiError => new ApiError(503, "DATABASE_UNAVAILABLE");
