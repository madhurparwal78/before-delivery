import type { FieldErrors } from '../../domain/validate.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly fields?: FieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.fields = fields;
  }

  body(): { error: Record<string, unknown> } {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    for (const [key, value] of Object.entries(this.extra)) error[key] = value;
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(status, code, message, extra);
}

export function validationFailed(fields: FieldErrors): ApiError {
  return new ApiError(422, 'validation_failed', 'Some fields need attention.', {}, fields);
}

export function notFound(): ApiError {
  return apiError(404, 'not_found', 'There is no such record here.');
}

export function forbidden(): ApiError {
  return apiError(403, 'forbidden', 'Your role cannot do that.');
}

export function unauthenticated(): ApiError {
  return apiError(401, 'unauthenticated', 'Sign in to Saltprint Desk first.');
}

export function takenDown(): ApiError {
  return apiError(410, 'taken_down', 'This essay was taken down.');
}

export function storageUnavailable(): ApiError {
  return apiError(503, 'storage_unavailable', 'Image storage is unreachable right now.');
}

export function illegalTransition(from: string, action: string): ApiError {
  return apiError(409, 'illegal_transition', `An essay in ${from} cannot take the ${action} action.`, {
    from,
    action,
  });
}
