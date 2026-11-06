// The one error shape of the API, and the status-only bodies it lists as exceptions.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export class HttpError extends Error {
  readonly status: number;
  readonly body: Json;
  readonly headers: Record<string, string>;
  constructor(status: number, body: Json, headers: Record<string, string> = {}) {
    super(typeof body === 'object' && body && !Array.isArray(body) ? String(body.error ?? body.status) : 'error');
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

/** `{"error": code, ...extra}` */
export function apiError(status: number, code: string, extra: Record<string, Json> = {}, headers: Record<string, string> = {}): HttpError {
  return new HttpError(status, { error: code, ...extra }, headers);
}

export const validation = (errors: Record<string, string>): HttpError => apiError(422, 'validation', { errors });
export const notFound = (): HttpError => apiError(404, 'not_found');

/** Status bodies: the health check's starting state and the share surface's link states. */
export const statusBody = (status: number, value: 'starting' | 'unknown' | 'expired' | 'revoked'): HttpError =>
  new HttpError(status, { status: value });

/** Collects per-field messages and throws one 422 when any were added. */
export class FieldErrors {
  readonly errors: Record<string, string> = {};
  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }
  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }
  throwIfAny(): void {
    if (this.any) throw validation(this.errors);
  }
}
