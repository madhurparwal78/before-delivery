import type { FieldErrors } from '../shared/validate.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden_role'
  | 'save_unavailable'
  | 'shape_deleted'
  | 'connector_deleted'
  | 'layer_locked'
  | 'op_conflict'
  | 'already_member'
  | 'already_invited'
  | 'invite_closed'
  | 'owner_role'
  | 'already_resolved'
  | 'email_taken'
  | 'export_not_ready'
  | 'export_not_retryable'
  | 'bad_credentials'
  | 'invalid'
  | 'cross_origin'
  | 'too_large'
  | 'unsupported_media_type';

/** Every API error is built through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) error['fields'] = this.fields;
    return { error };
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

/**
 * The not-found rule. Every case it covers answers with this exact body, so a diagram
 * someone cannot read is indistinguishable from one that never existed.
 */
export const notFound = (): ApiError => new ApiError(404, 'not_found', 'Diagram not found.');

export const forbiddenRole = (): ApiError =>
  new ApiError(403, 'forbidden_role', 'Your role does not allow this.');

export const saveUnavailable = (): ApiError =>
  new ApiError(503, 'save_unavailable', 'Saving is unavailable. Try again shortly.');

export const conflict = (code: ErrorCode, message: string): ApiError => new ApiError(409, code, message);

export const invalidRequest = (fields: FieldErrors, message = 'Check the highlighted fields.'): ApiError =>
  new ApiError(422, 'invalid', message, fields);

export const badCredentials = (): ApiError =>
  new ApiError(401, 'bad_credentials', 'Email or password is incorrect.');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Cross-origin state changes are refused.');

export const tooLarge = (): ApiError => new ApiError(413, 'too_large', 'The request body is too large.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'Send application/json.');
