export type ApiErrorBody = { error: string; message: string };
export type ValidationErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | { errors: ValidationErrors };

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.body = { error: code, message };
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly body: { errors: ValidationErrors };

  constructor(errors: ValidationErrors) {
    super('validation failed');
    this.body = { errors };
  }
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export const CONFLICT_MESSAGES = {
  stale: 'This workout changed since you opened it. Reload to see the latest.',
  locked: 'Completed sessions stay on their day.',
  already_linked: 'You are already linked with this coach.',
  already_requested: 'You already have a pending request with this coach.',
  expired: 'This request has expired. Ask the athlete to send a new one.',
  not_pending: 'This request is no longer pending.',
} as const;

export function providerUnavailable(kind: 'upload' | 'file'): ApiError {
  const message =
    kind === 'upload'
      ? 'Activity storage is unavailable. Your file was not saved; try again in a few minutes.'
      : 'Original files are unavailable right now; try again in a few minutes.';
  return new ApiError(503, 'storage_unavailable', message);
}
