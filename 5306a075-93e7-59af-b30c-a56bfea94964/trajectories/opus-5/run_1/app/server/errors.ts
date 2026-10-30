import type { ApiErrorBody } from '../shared/types';

/**
 * The one error shape for the whole API. Every failure is raised as an AppError
 * and serialised here; no handler writes its own error body.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } } as ApiErrorBody;
  }
}

export const methodNotAllowed = (): AppError =>
  new AppError(405, 'method_not_allowed', 'This method is not supported for this path.');

export const payloadTooLarge = (): AppError =>
  new AppError(413, 'payload_too_large', 'The request body is larger than the limit.');

export const unsupportedMediaType = (): AppError =>
  new AppError(415, 'unsupported_media_type', 'The request body must be JSON.');

export const unauthenticated = (): AppError =>
  new AppError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidCredentials = (): AppError =>
  new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');

export const notFound = (): AppError => new AppError(404, 'not_found', 'No such record.');

export const forbidden = (): AppError =>
  new AppError(403, 'forbidden', 'Your role may not perform this action.');

export const crossOrigin = (): AppError =>
  new AppError(403, 'cross_origin', 'State-changing requests must come from this origin.');

export const validationFailed = (fields: Record<string, string>): AppError =>
  new AppError(422, 'validation_failed', 'Some fields need attention.', { fields });

export const storageUnavailable = (): AppError =>
  new AppError(503, 'storage_unavailable', 'Object storage is unavailable. Try again in a minute.');

export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError(409, code, message, extra);

export const gone = (code: string, message: string): AppError => new AppError(410, code, message);

export const internalError = (): AppError =>
  new AppError(500, 'internal_error', 'Something went wrong on our side. Nothing was saved.');

export const NO_SUCH_RECORD = 'No such record in this workspace.';
