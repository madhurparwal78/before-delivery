/** Every API error is built here: `{"error": code}` plus the extra fields a code names. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string } & Record<string, unknown>,
  ) {
    super(body.error);
  }
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, { error, ...extra });
}

export const unauthenticated = (): ApiError => fail(401, 'unauthenticated');
export const notFound = (): ApiError => fail(404, 'not_found');
export const forbidden = (): ApiError => fail(403, 'forbidden');
export const tooLarge = (): ApiError => fail(413, 'too_large');
export const liveUnavailable = (): ApiError => fail(503, 'live_unavailable');
export const storageUnavailable = (): ApiError => fail(503, 'storage_unavailable');
export const databaseUnavailable = (): ApiError => fail(503, 'database_unavailable');

/** Collects field messages for one 422 `validation` answer. */
/** 422 with one message per field. */
export const validation = (errors: Record<string, string>): ApiError => fail(422, 'validation', { errors });

export class Fields {
  readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    this.errors[field] ??= message;
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  check(): void {
    if (this.any) throw validation(this.errors);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
