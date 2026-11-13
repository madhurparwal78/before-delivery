import type { Context } from 'hono';
import type { ErrorBody, ValidationBody } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    readonly status: 401 | 404 | 409 | 413 | 415 | 422 | 500 | 503,
    readonly body: ErrorBody | ValidationBody
  ) {
    super('message' in body ? body.message : 'validation failed');
  }
}

const failure = (status: ApiError['status'], error: string, message: string): ApiError =>
  new ApiError(status, { error, message });

export const unauthenticated = (): ApiError => failure(401, 'unauthenticated', 'Sign in to continue.');
export const notFound = (): ApiError => failure(404, 'not_found', 'Not found.');
export const payloadTooLarge = (): ApiError => failure(413, 'payload_too_large', 'The request is too large.');
export const invalidCredentials = (): ApiError => failure(401, 'invalid_credentials', 'Email or password is incorrect.');
export const internalError = (): ApiError => failure(500, 'internal_error', 'Something went wrong on our side.');
export const serviceStarting = (): ApiError => failure(503, 'starting', 'The service is starting.');
export const fileTooLarge = (max: number): ApiError => failure(413, 'file_too_large', `This file is larger than ${max} bytes.`);
export const unsupportedType = (): ApiError => failure(415, 'unsupported_type', 'Upload a .csv or .json activity file.');
export const validation = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });

const CONFLICTS = {
  stale: 'This workout changed since you opened it. Reload to see the latest.',
  locked: 'Completed sessions stay on their day.',
  already_linked: 'You are already linked with this coach.',
  already_requested: 'You already have a pending request with this coach.',
  expired: 'This request has expired. Ask the athlete to send a new one.',
  not_pending: 'This request is no longer pending.'
} as const;

export const conflict = (code: keyof typeof CONFLICTS): ApiError => failure(409, code, CONFLICTS[code]);

export const storageUnavailable = (during: 'upload' | 'original'): ApiError =>
  failure(
    503,
    'storage_unavailable',
    during === 'upload'
      ? 'Activity storage is unavailable. Your file was not saved; try again in a few minutes.'
      : 'Original files are unavailable right now; try again in a few minutes.'
  );

export class StorageFailure extends Error {}

/** Collects every invalid field of a request before it is refused. */
export class FieldErrors {
  readonly fields: Record<string, string> = {};

  add(field: string, message: string | null): void {
    if (message !== null && !(field in this.fields)) this.fields[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw validation(this.fields);
  }
}

/** The one place an API error becomes a response. */
export function respond(c: Context, error: ApiError): Response {
  return c.json(error.body, error.status);
}
