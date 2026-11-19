export type ErrorExtras = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    extras: ErrorExtras = {},
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.extras = extras;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extras };
  }
}

export type FieldErrors = Record<string, string>;

export const NOT_WRITABLE = 'Field is not writable.';

export function validation(errors: FieldErrors): ApiError {
  return new ApiError(422, 'validation', 'Some fields need attention.', { errors });
}

export function notFound(what = 'That resource does not exist.'): ApiError {
  return new ApiError(404, 'not_found', what);
}

export function conflict(code: string, message: string, extras: ErrorExtras = {}): ApiError {
  return new ApiError(409, code, message, extras);
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to the console first.');
}

export function gone(code: string, message: string): ApiError {
  return new ApiError(410, code, message);
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'Storage is unreachable. Try again shortly.');
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, 'billing_unavailable', 'Billing is unreachable. Try again shortly.');
}

export function databaseUnavailable(): ApiError {
  return new ApiError(503, 'database_unavailable', 'The database is unreachable. Try again shortly.');
}
