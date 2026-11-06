import type { ServerResponse } from 'node:http';

export interface ApiError {
  status: number;
  code: string;
  message: string;
  errors?: Record<string, string>;
  extra?: Record<string, unknown>;
  retryAfter?: number;
}

export class ApiFail extends Error {
  readonly err: ApiError;
  constructor(status: number, code: string, message: string, opts?: { errors?: Record<string, string>; extra?: Record<string, unknown>; retryAfter?: number }) {
    super(`${status} ${code}: ${message}`);
    this.err = { status, code, message, errors: opts?.errors, extra: opts?.extra, retryAfter: opts?.retryAfter };
  }
}

export function fail(status: number, code: string, message: string, opts?: { errors?: Record<string, string>; extra?: Record<string, unknown>; retryAfter?: number }): ApiFail {
  return new ApiFail(status, code, message, opts);
}

export function validationFailed(errors: Record<string, string>): ApiFail {
  return new ApiFail(422, 'validation_failed', 'Validation failed.', { errors });
}

export function notFound(): ApiFail { return new ApiFail(404, 'not_found', 'Not found.'); }
export function unauthenticated(): ApiFail { return new ApiFail(401, 'unauthenticated', 'Sign in to continue.'); }
export function twoStepRequired(): ApiFail { return new ApiFail(401, 'two_step_required', 'Enter the code from your authenticator app to finish signing in.'); }
export function invalidCredentials(): ApiFail { return new ApiFail(401, 'invalid_credentials', 'Email or password is incorrect.'); }
export function forbidden(message = "You can't do that."): ApiFail { return new ApiFail(403, 'forbidden', message); }
export function stepUpRequired(): ApiFail { return new ApiFail(403, 'step_up_required', "Confirm it's you with a code from your authenticator app."); }
export function workspaceSuspended(): ApiFail { return new ApiFail(403, 'workspace_suspended', 'This workspace is suspended.'); }
export function serviceUnavailable(): ApiFail { return new ApiFail(503, 'service_unavailable', "Farshore can't do that right now."); }
export function storageUnavailable(): ApiFail { return new ApiFail(503, 'storage_unavailable', "Farshore can't reach storage right now."); }
export function regionOffline(): ApiFail { return new ApiFail(503, 'region_offline', "This bucket's origin region is offline."); }
export function rateLimited(retryAfter: number): ApiFail { return new ApiFail(429, 'rate_limited', 'Too many requests.', { retryAfter }); }
export function invalidTransition(fromState: string, toState: string): ApiFail {
  return new ApiFail(409, 'invalid_transition', "That change isn't allowed from the current state.", { extra: { from: fromState, to: toState } });
}
export function objectLocked(retainUntil: string | null, legalHold: boolean): ApiFail {
  return new ApiFail(409, 'object_locked', 'This version is locked.', { extra: { retain_until: retainUntil, legal_hold: legalHold } });
}

/** Sends a JSON error in the single documented shape. */
export function sendJsonError(res: ServerResponse, e: ApiError): void {
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.errors) body.errors = e.errors;
  if (e.extra) Object.assign(body, e.extra);
  if (e.status === 429) {
    body.retry_after_seconds = e.retryAfter ?? 1;
  }
  const json = JSON.stringify(body);
  res.writeHead(e.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    ...(e.status === 429 ? { 'Retry-After': String(e.retryAfter ?? 1) } : {}),
  });
  res.end(json);
}

export function isApiFail(e: unknown): e is ApiFail {
  return e instanceof ApiFail;
}
