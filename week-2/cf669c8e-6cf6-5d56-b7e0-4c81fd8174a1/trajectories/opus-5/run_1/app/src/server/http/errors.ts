/**
 * The one failure shape for the whole API.
 *
 * Failures are `{"error":"<code>"}`, or for validation
 * `422 {"errors":{"<field>":"<message>"}}`.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super(`422 ${Object.keys(errors).join(',')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** An idempotent replay: the stored answer is returned as it stands. */
export class IdempotentReplay extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`replay ${status}`);
    this.name = 'IdempotentReplay';
    this.status = status;
    this.body = body;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const conflict = (code: string): ApiError => new ApiError(409, code);
export const registryUnreachable = (): ApiError => new ApiError(503, 'registry_unreachable');
export const paymentsPaused = (): ApiError => new ApiError(503, 'payments_paused');
export const paymentRefused = (): ApiError => new ApiError(402, 'payment_refused');
