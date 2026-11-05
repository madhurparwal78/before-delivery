import type { ApiErrorBody } from '../../shared/types.ts';

/** Every API error is produced through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export function tooLarge(): ApiError {
  return new ApiError(413, 'too_large', 'That request body is larger than this endpoint accepts.');
}

export function unsupportedMediaType(message = 'That content type is not accepted here.'): ApiError {
  return new ApiError(415, 'unsupported_media_type', message);
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to use this.');
}

export function invalidCode(): ApiError {
  return new ApiError(401, 'invalid_code', 'That code does not match anyone in this club.');
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'There is nothing here.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'That is not yours to use.');
}

export function validation(fields: Record<string, string>, message = 'Some details need fixing.'): ApiError {
  return new ApiError(422, 'validation', message, fields);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function preconditionRequired(etag: string): ApiError {
  return new ApiError(428, 'precondition_required', 'Send the cycle revision you are editing.', undefined, {
    ETag: etag,
  });
}

export function staleCycle(etag: string): ApiError {
  return new ApiError(412, 'stale_cycle', 'Someone else changed this cycle.', undefined, { ETag: etag });
}

export function paymentsPaused(): ApiError {
  return new ApiError(503, 'payments_paused', 'Payments are paused right now.');
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'File storage is unavailable right now.');
}

export function databaseBusy(): ApiError {
  return new ApiError(503, 'database_busy', 'The records are busy; try again.');
}
