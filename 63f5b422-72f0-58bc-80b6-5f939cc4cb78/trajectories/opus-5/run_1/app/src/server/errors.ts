import { OpFailure, type Fields } from '../shared/ops.js';

/** Every API error travels as one shape with the codes this brief names. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Fields | undefined;

  constructor(status: number, code: string, message: string, fields?: Fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): { error: { code: string; message: string; fields?: Fields } } {
    const error: { code: string; message: string; fields?: Fields } = {
      code: this.code,
      message: this.message,
    };
    if (this.status === 422) error.fields = this.fields ?? {};
    return { error };
  }
}

export function fromOpFailure(failure: OpFailure): ApiError {
  return new ApiError(failure.status, failure.code, failure.message, failure.fields);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof OpFailure) return fromOpFailure(error);
  return new ApiError(500, 'internal', 'Something went wrong.');
}

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');
export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in first.');
export const forbiddenRole = (): ApiError =>
  new ApiError(403, 'forbidden_role', 'Your role does not allow that.');
export const invalidFields = (fields: Fields): ApiError =>
  new ApiError(422, 'invalid', 'Some values are not valid.', fields);
export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);
