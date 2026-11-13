// One error shape for the whole API, and the published error order.
import { COPY } from '../domain/copy';

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'bad_credentials'
  | 'cross_origin'
  | 'unsupported_media_type'
  | 'too_large'
  | 'layer_held'
  | 'layer_locked'
  | 'trashed'
  | 'already_trashed'
  | 'not_trashed'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'idempotency_conflict'
  | 'validation'
  | 'limit_reached'
  | 'storage_unavailable'
  | 'invite_unavailable'
  | 'wrong_person'
  | 'immutable';

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  fields: Record<string, string> | null;

  constructor(status: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
  }

  body(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length > 0) {
      out.errors = this.fields;
      const first = Object.values(this.fields)[0];
      if (first !== undefined) out.message = first;
    }
    return out;
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', COPY.unauthenticated);
}
export function notFound(): ApiError {
  return new ApiError(404, 'not_found', COPY.notFound);
}
export function forbidden(message: string): ApiError {
  return new ApiError(403, 'forbidden', message);
}
export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', Object.values(fields)[0] ?? '', fields);
}
export function validationMessage(message: string, path: string): ApiError {
  return validation({ [path]: message });
}
export function storageUnavailable(message: string): ApiError {
  return new ApiError(503, 'storage_unavailable', message);
}
export function conflict(code: Exclude<ErrorCode, 'validation' | 'unauthenticated' | 'not_found' | 'forbidden'>, message: string): ApiError {
  return new ApiError(409, code, message);
}
